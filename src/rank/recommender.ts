// src/rank/recommender.ts
// 给每个 Wheel 生成推荐信息(matchScore + recommendation 等级 + reason 理由)。
// 目的:让调用方 AI 看到结构化的推荐等级,倾向于列出多个结果让用户选择,
// 而不是只挑 1 个展示。
//
// Phase 6 简化后:
// 删除领域特定 stars 归一化分母(DOMAIN_STARS_DENOMINATOR)。
// 统一用 10000 作为 stars 分母,避免领域配置表带来的维护负担。
// AI 调用方拿到 stars 原值 + matchScore 后自己判断领域相对热度。
//
// N6 修复:HuggingFace 的 stars 实际是 likes(量级 < 100),用 10000 归一化后热度几乎为 0,
// 导致 AI 模型永远达不到 highly_recommended。改为按 source 选择分母:
// - github/gitee/gitlab/librariesio:真实 stars,分母 10000
// - huggingface:likes 量级,分母 500
// - 其他源:无 stars 或 stars 继承自 GitHub,用默认 10000

import { topicMatches, matchesKeyword } from '../util/keywordMatch.js';
import { gradeRecommendation } from '../util/recommendation.js';
import type { Wheel, Recommendation, WheelMatch, WheelSource } from '../normalize/types.js';
// P1-9:不再需要 ONE_YEAR_MS —— activity 字段统一由 metricsEnricher.inferActivity 计算

// gradeRecommendation 及相关常量已下沉到 src/util/recommendation.ts(消除 feedback→rank 反向依赖)。
// 此处 re-export 保持向后兼容(已有 import { gradeRecommendation } from '../rank/recommender.js' 的代码不受影响)。
export { gradeRecommendation } from '../util/recommendation.js';

/**
 * stars 归一化分母(按 source 差异化)。
 * N6:不同源的 stars 字段含义/量级差异巨大:
 * - GitHub/Gitee/GitLab/Libraries.io:真实 stars,主流库 10k+,分母 10000
 * - HuggingFace:实际是 likes(点赞数),顶级模型也才几百,分母 500
 * - 其他源(npm/crates/pypi/maven/rubygems/gopkg...):无 stars 或继承自 GitHub,用默认 10000
 */
const STARS_DENOMINATOR_BY_SOURCE: Partial<Record<WheelSource, number>> = {
  github: 10000,
  gitee: 5000,       // Gitee stars 量级普遍低于 GitHub
  gitlab: 5000,      // GitLab stars 量级普遍低于 GitHub
  librariesio: 10000, // 继承自 GitHub,量级相同
  huggingface: 500,  // likes 量级远小于 stars
  'github-code': 10000, // 继承自 GitHub 仓库 stars
  paperswithcode: 1000, // 关联 repo stars,通常量级较小
};

const DEFAULT_STARS_DENOMINATOR = 10000;

/**
 * stars 显示为 "X.Xk" 格式的阈值(>= 1k 时用 k 后缀缩写)。
 * 同时作为 buildReason 热度描述里"中等热度"的下限(stars >= 1k 视为中等热度)。
 * 集中到一处避免显示与分级阈值漂移。
 */
const K_STARS_THRESHOLD = 1000;

function getStarsDenominator(source: WheelSource): number {
  return STARS_DENOMINATOR_BY_SOURCE[source] ?? DEFAULT_STARS_DENOMINATOR;
}

/**
 * 计算单个 Wheel 的匹配信息。
 *
 * matchScore 构成(0~1.1):
 * - 相关度(0~0.6):description/name/topics 命中 query 关键词的比例(原 0.5 + topics 0.1 + name 0.1,钳制到 0.6)
 * - 热度(0~0.3):stars 归一化(stars 本身已被 Ranker 降权过,这里只看绝对值)
 * - 活跃度(0~0.2):最近更新时间 + activity
 *
 * 注:理论上限 0.6+0.3+0.2=1.1,但 feedbackWeighter 钳制到 [0, 1.5]
 * (1.1 满分 + 0.4 反馈空间),避免热门项目因反馈累积霸榜。
 *
 * recommendation 等级:
 * - highly_recommended: score >= 0.6 且 stars 达到 source 对应阈值(见 util/recommendation.ts 的 HIGHLY_RECOMMENDED_STARS_BY_SOURCE)
 * - recommended: score >= 0.4
 * - optional: score >= 0.2
 * - not_recommended: score < 0.2
 */
export function computeMatch(
  wheel: Wheel,
  queryKeywords: string[],
  query: string = '',
): WheelMatch {
  const text = `${wheel.name} ${wheel.description}`.toLowerCase();
  // 命中的关键词
  // N8:短关键词(≤3 字符如 js/ts/ai/c/go)用子串匹配会误匹配(js 命中 ajax、ai 命中 raid),
  // 与 ranker 的 matchesKeyword 保持一致,改用词边界匹配。
  const matchedKeywords = queryKeywords.filter(kw =>
    matchesKeyword(text, kw.toLowerCase()),
  );

  // 1. 相关度(0~0.5):命中率
  // R1/R2 增强:topics 和 name 命中也算相关度,加权计算
  const hitRate = queryKeywords.length > 0
    ? matchedKeywords.length / queryKeywords.length
    : 0;
  let relevanceScore = hitRate * 0.5;

  // 优化24:转换模式 bonus —— query 是 "X to Y" 模式时,description 含转换短语加分。
  // 场景:query="html to pdf",crawlee desc="Download HTML, PDF, JPG..."(命中但语义不对),
  // html2pdf.js desc="Client-side HTML-to-PDF rendering"(命中且语义对)。
  // 规则:desc 含 "X to Y" / "X-to-Y" / "X2Y" / "X to Y converter/convert" 加 0.15 bonus。
  // 反向模式("Y to X")由 ranker.ts 的 isReverseToIntent 已处理(软降权)。
  // 注:bonus 独立于 relevanceScore 上限(0.6),不受钳制影响 —— 真正的转换工具应获得额外优势。
  let convBonus = 0;
  if (query) {
    convBonus = conversionPatternBonus(query, wheel.description || '', wheel.name || '');
  }

  // R1:topics 命中额外加分(最多 +0.1)
  // N8:短关键词(≤3 字符如 js/ts/ai/c/go)用子串匹配会误匹配(如 js 匹配 vue-js、ai 匹配 raid)
  // 改为:短关键词要求精确匹配或 kebab-case 边界匹配
  if (wheel.topics && wheel.topics.length > 0 && queryKeywords.length > 0) {
    const topicsLower = wheel.topics.map(t => t.toLowerCase());
    const topicsHits = queryKeywords.filter(kw =>
      topicsLower.some(t => topicMatches(t, kw.toLowerCase())),
    ).length;
    if (topicsHits > 0) {
      relevanceScore += Math.min(topicsHits / queryKeywords.length, 1) * 0.1;
    }
  }

  // R2:name 命中额外加分(最多 +0.1)
  if (wheel.name && queryKeywords.length > 0) {
    const nameLower = wheel.name.toLowerCase();
    const nameHits = queryKeywords.filter(kw => nameLower.includes(kw.toLowerCase())).length;
    if (nameHits > 0) {
      relevanceScore += Math.min(nameHits / queryKeywords.length, 1) * 0.1;
    }
  }
  // 相关度上限 0.5(原值)+ 0.1(topics) + 0.1(name) = 0.7,但钳制到 0.6 避免过度
  relevanceScore = Math.min(relevanceScore, 0.6);

  // 2. 热度(0~0.3):stars 归一化(N6:按 source 差异化分母)
  const stars = wheel.metrics.stars ?? 0;
  const denominator = getStarsDenominator(wheel.source);
  let popularityScore = Math.min(stars / denominator, 1) * 0.3;

  // 优化23:低命中率降权(与 ranker.ts isLowHitRate 保持一致)
  // 场景:apify/crawlee(24821★)搜 "html to pdf" 只命中 1/2=50% 关键词("html"),
  // 不应靠高 stars 在 popularity 上压制 html2pdf.js(1222★,100% 命中)。
  // 注:ranker.ts 的 score() 已应用此降权,但 enrichWithMatch 用 computeMatch 独立计算
  // match.score,applyIntentBoost 又按 match.score 重新排序,会覆盖 rank() 的正确顺序。
  // 此处同步应用降权,确保 score 计算路径一致。
  if (queryKeywords.length > 0) {
    const hitRate = matchedKeywords.length / queryKeywords.length;
    if (hitRate < 0.5) {
      popularityScore *= 0.2;
    }
  }

  // 3. 活跃度(0~0.2):基于 metrics.activity(P1-9:统一由 metricsEnricher.inferActivity 计算)
  // 注:enrich 阶段保证 activity 字段已填充(默认 'low'),不再二次估算
  const activity = wheel.metrics.activity ?? 'low';
  let activityScore = 0;
  if (activity === 'high') activityScore = 0.2;
  else if (activity === 'medium') activityScore = 0.1;
  else if (activity === 'low') activityScore = 0.05;

  const score = relevanceScore + popularityScore + activityScore + convBonus;
  let recommendation = gradeRecommendation(score, stars, wheel.source);

  // 优化4:关键词命中率阈值 —— 避免"高 star 但低相关"项目拿到 highly_recommended。
  // 场景:@n8n/design-system 搜 "design system components vue" 时只命中 1/4 关键词("system"),
  // 但因 stars 高 + activity high 总分 > 0.6 → 误判为 highly_recommended。
  // 规则:命中率 < 50% 时,recommendation 最高降级到 optional(无论 stars 多高)。
  // 注:hitRate=0 的项目走原有 gradeRecommendation 即可(not_recommended/optional),
  //     此处只压制"有部分命中但不到一半"的高 star 项目。
  if (queryKeywords.length > 0) {
    const hitRate = matchedKeywords.length / queryKeywords.length;
    if (hitRate < 0.5 && recommendation === 'highly_recommended') {
      recommendation = 'optional';
    }
  }

  const reason = buildReason(wheel, matchedKeywords, queryKeywords);
  const recallReason = buildRecallReason(matchedKeywords, stars, activity);

  return { score, recommendation, reason, matchedKeywords, recallReason };
}

/**
 * 生成召回解释(C 阶段):说明该 wheel 为什么被召回。
 * 形如 "命中核心词 stepper/motor;3.0k stars;近 1 年有更新"。
 * 帮助 AI 调用方快速判断相关性,减少误判。
 *
 * 与 reason 的区别:
 * - reason:综合推荐理由,含 license 等次要信息,较长
 * - recallReason:聚焦"为什么召回"的核心信息,简短,AI 一眼能判断
 */
function buildRecallReason(
  matchedKeywords: string[],
  stars: number,
  activity: string | undefined,
): string {
  const parts: string[] = [];

  // 1. 命中情况(最关键)
  if (matchedKeywords.length > 0) {
    // 只取前 3 个命中词,避免太长
    const preview = matchedKeywords.slice(0, 3).join('/');
    parts.push(`命中 ${preview}`);
  } else {
    parts.push('零关键词命中(可能不相关)');
  }

  // 2. 热度
  if (stars > 0) parts.push(formatStars(stars));

  // 3. 更新活跃度
  if (activity === 'high') parts.push('活跃维护');
  else if (activity === 'medium') parts.push('近期有更新');
  else if (activity === 'low') parts.push('更新缓慢');

  return parts.join('; ');
}

/**
 * 推荐等级的中文标签 + 排序顺序(供 findWheelTool 等 summary 输出复用)。
 * 集中在 recommender.ts 一处定义,避免散落在多处导致不一致。
 */
export const REC_LABELS: Record<Recommendation, string> = {
  highly_recommended: '强烈推荐',
  recommended: '推荐',
  optional: '可选',
  not_recommended: '不推荐',
};
export const REC_ORDER: Recommendation[] = [
  'highly_recommended', 'recommended', 'optional', 'not_recommended',
];

/**
 * 生成推荐理由(中文简述)。
 * 规则版,不能用 LLM。基于命中情况 + 热度 + 活跃度组合。
 */
function buildReason(
  wheel: Wheel,
  matchedKeywords: string[],
  queryKeywords: string[],
): string {
  const parts: string[] = [];
  const hitRate = queryKeywords.length > 0
    ? matchedKeywords.length / queryKeywords.length
    : 0;
  const stars = wheel.metrics.stars ?? 0;
  const activity = wheel.metrics.activity;

  // 相关性描述
  if (hitRate >= 0.75) {
    parts.push(`高度匹配(命中 ${matchedKeywords.length}/${queryKeywords.length} 关键词)`);
  } else if (hitRate >= 0.5) {
    parts.push(`较匹配(命中 ${matchedKeywords.length}/${queryKeywords.length})`);
  } else if (hitRate > 0) {
    parts.push(`部分匹配(命中 ${matchedKeywords.length}/${queryKeywords.length})`);
  } else {
    parts.push('关键词匹配度低');
  }

  // 热度描述
  if (stars >= 10000) parts.push(`高热度(${formatStars(stars)})`);
  else if (stars >= K_STARS_THRESHOLD) parts.push(`中等热度(${formatStars(stars)})`);
  else if (stars > 0) parts.push(`小众项目(${formatStars(stars)})`);

  // 活跃度描述
  if (activity === 'high') parts.push('活跃维护');
  else if (activity === 'medium') parts.push('近期有更新');
  else if (activity === 'low') parts.push('更新缓慢');

  // license
  if (wheel.metrics.license) {
    parts.push(`license: ${wheel.metrics.license}`);
  }

  return parts.join(', ');
}

function formatStars(stars: number): string {
  if (stars >= K_STARS_THRESHOLD) return `${(stars / K_STARS_THRESHOLD).toFixed(1)}k stars`;
  return `${stars} stars`;
}

/**
 * 转换模式 bonus(优化24)。
 *
 * query 是 "X to Y" 模式时,检测 description/name 是否含转换短语:
 * - "X to Y" (空格分隔,如 "html to pdf")
 * - "X-to-Y" (kebab-case,如 "html-to-pdf")
 * - "X2Y" (无分隔,如 "html2pdf")
 * - "X to Y converter" / "X to Y conversion"
 *
 * 场景:query="html to pdf"
 * - html2pdf.js:desc="Client-side HTML-to-PDF rendering" → 含 "html-to-pdf" ✓ +0.15
 * - crawlee:desc="Download HTML, PDF, JPG, PNG" → 不含转换模式 ✗ +0
 *
 * 这解决"关键词命中但语义不对"问题:crawlee 含 "HTML" 和 "PDF" 但语义是"下载文件",
 * 不是"HTML 转 PDF",转换模式 bonus 让真正的转换工具获得额外加分。
 *
 * 注:反向模式("Y to X")由 ranker.ts 的 isReverseToIntent 处理(软降权),
 * 此处不重复检测。
 */
function conversionPatternBonus(query: string, description: string, name: string): number {
  // 提取 query 中的 "X to Y" 模式
  const m = query.match(/(\w+)\s+to\s+(\w+)/i);
  if (!m) return 0;
  const [, from, to] = m;
  const fromL = from.toLowerCase();
  const toL = to.toLowerCase();
  const text = `${description} ${name}`.toLowerCase();

  // 检测转换模式:from-to-to / from2to / "from to to" / "from to to converter"
  const patterns = [
    `${fromL}-${toL}`,           // html-to-pdf
    `${fromL} to ${toL}`,        // html to pdf
    `${fromL}2${toL}`,           // html2pdf
    `${fromL}2${toL[0]?.toUpperCase() || ''}${toL.slice(1)}`, // html2Pdf(CamelCase 变体)
  ];
  for (const p of patterns) {
    if (text.includes(p)) return 0.25;
  }
  // 检测 "convert X to Y" / "X to Y converter" / "X to Y conversion"
  const convertPatterns = [
    new RegExp(`\\bconvert.*${fromL}.*${toL}\\b`, 'i'),
    new RegExp(`\\b${fromL}\\s+to\\s+${toL}\\s+(?:converter|conversion|rendering|renderer)\\b`, 'i'),
  ];
  for (const p of convertPatterns) {
    if (p.test(text)) return 0.25;
  }
  return 0;
}

/**
 * 批量给 Wheel 列表填充 match 字段。
 * 输入是已排好序的 Wheel 列表(来自 rank()),原地填充 match 字段。
 */
export function enrichWithMatch(
  wheels: Wheel[],
  queryKeywords: string[],
  query: string = '',
): Wheel[] {
  return wheels.map(w => ({ ...w, match: computeMatch(w, queryKeywords, query) }));
}
