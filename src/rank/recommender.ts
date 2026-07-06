// src/rank/recommender.ts
// 给每个 Wheel 生成推荐信息(matchScore + recommendation 等级 + reason 理由)。
// 目的:让调用方 AI 看到结构化的推荐等级,倾向于列出多个结果让用户选择,
// 而不是只挑 1 个展示。
//
// Phase 6 简化后:
// 删除领域特定 stars 归一化分母(DOMAIN_STARS_DENOMINATOR)。
// 统一用 10000 作为 stars 分母,避免领域配置表带来的维护负担。
// AI 调用方拿到 stars 原值 + matchScore 后自己判断领域相对热度。

import type { Wheel, Recommendation, WheelMatch } from '../normalize/types.js';
// P1-9:不再需要 ONE_YEAR_MS —— activity 字段统一由 metricsEnricher.inferActivity 计算

/**
 * stars 归一化分母(统一值)。
 * 不同领域 stars 天花板不同,但 findawheel 不再硬编码领域分母 ——
 * AI 看到 stars 原值后自己判断领域相对热度(嵌入式 1k stars 已是主流,
 * 前端 1k stars 是小众,这种领域知识 AI 比硬规则更准确)。
 */
const STARS_DENOMINATOR = 10000;

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
 * - highly_recommended: score >= 0.6 且 stars >= 1000
 * - recommended: score >= 0.4
 * - optional: score >= 0.2
 * - not_recommended: score < 0.2
 */
export function computeMatch(
  wheel: Wheel,
  queryKeywords: string[],
): WheelMatch {
  const text = `${wheel.name} ${wheel.description}`.toLowerCase();
  // 命中的关键词
  const matchedKeywords = queryKeywords.filter(kw =>
    text.includes(kw.toLowerCase()),
  );

  // 1. 相关度(0~0.5):命中率
  // R1/R2 增强:topics 和 name 命中也算相关度,加权计算
  const hitRate = queryKeywords.length > 0
    ? matchedKeywords.length / queryKeywords.length
    : 0;
  let relevanceScore = hitRate * 0.5;

  // R1:topics 命中额外加分(最多 +0.1)
  if (wheel.topics && wheel.topics.length > 0 && queryKeywords.length > 0) {
    const topicsLower = wheel.topics.map(t => t.toLowerCase());
    const topicsHits = queryKeywords.filter(kw =>
      topicsLower.some(t => t.includes(kw.toLowerCase()) || kw.toLowerCase().includes(t)),
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

  // 2. 热度(0~0.3):stars 归一化(统一分母)
  const stars = wheel.metrics.stars ?? 0;
  const popularityScore = Math.min(stars / STARS_DENOMINATOR, 1) * 0.3;

  // 3. 活跃度(0~0.2):基于 metrics.activity(P1-9:统一由 metricsEnricher.inferActivity 计算)
  // 注:enrich 阶段保证 activity 字段已填充(默认 'low'),不再二次估算
  const activity = wheel.metrics.activity ?? 'low';
  let activityScore = 0;
  if (activity === 'high') activityScore = 0.2;
  else if (activity === 'medium') activityScore = 0.1;
  else if (activity === 'low') activityScore = 0.05;

  const score = relevanceScore + popularityScore + activityScore;
  const recommendation = gradeRecommendation(score, stars);
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
 * 推荐等级阈值常量(gradeRecommendation 用)。
 * 集中管理避免散落在多处导致不一致。
 *
 * 等级定义:
 * - highly_recommended: score >= 0.6 且 stars >= 1000(高分且具备主流热度)
 * - recommended:        score >= 0.4(相关度较好)
 * - optional:           score >= 0.2(弱相关,可备选)
 * - not_recommended:    score < 0.2(不推荐)
 */
const HIGHLY_RECOMMENDED_SCORE = 0.6;
const HIGHLY_RECOMMENDED_STARS = 1000;
const RECOMMENDED_SCORE = 0.4;
const OPTIONAL_SCORE = 0.2;

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

/** 根据分数和 stars 计算推荐等级。导出供 feedback 调整后重新分级使用。 */
export function gradeRecommendation(score: number, stars: number): Recommendation {
  if (score >= HIGHLY_RECOMMENDED_SCORE && stars >= HIGHLY_RECOMMENDED_STARS) return 'highly_recommended';
  if (score >= RECOMMENDED_SCORE) return 'recommended';
  if (score >= OPTIONAL_SCORE) return 'optional';
  return 'not_recommended';
}

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
  else if (stars >= 1000) parts.push(`中等热度(${formatStars(stars)})`);
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
  if (stars >= 1000) return `${(stars / 1000).toFixed(1)}k stars`;
  return `${stars} stars`;
}

/**
 * 批量给 Wheel 列表填充 match 字段。
 * 输入是已排好序的 Wheel 列表(来自 rank()),原地填充 match 字段。
 */
export function enrichWithMatch(
  wheels: Wheel[],
  queryKeywords: string[],
): Wheel[] {
  return wheels.map(w => ({ ...w, match: computeMatch(w, queryKeywords) }));
}
