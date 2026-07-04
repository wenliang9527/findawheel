// src/rank/recommender.ts
// 给每个 Wheel 生成推荐信息(matchScore + recommendation 等级 + reason 理由)。
// 目的:让调用方 AI 看到结构化的推荐等级,倾向于列出多个结果让用户选择,
// 而不是只挑 1 个展示。

import type { Wheel, Recommendation, WheelMatch } from '../normalize/types.js';

/**
 * 计算单个 Wheel 的匹配信息。
 *
 * matchScore 构成(0~1):
 * - 相关度(0~0.5):description/name 命中 query 关键词的比例
 * - 热度(0~0.3):stars 归一化(stars 本身已被 Ranker 降权过,这里只看绝对值)
 * - 活跃度(0~0.2):最近更新时间 + activity
 *
 * recommendation 等级:
 * - highly_recommended: score >= 0.6 且 stars >= 1000
 * - recommended: score >= 0.4
 * - optional: score >= 0.2
 * - not_recommended: score < 0.2
 *
 * @param domain 识别到的领域(如 'embedded'),影响 stars 归一化分母。
 *               嵌入式库 stars 普遍偏低(1k stars 已是主流库),用更小分母 3000。
 */
export function computeMatch(
  wheel: Wheel,
  queryKeywords: string[],
  domain?: string | null,
): WheelMatch {
  const text = `${wheel.name} ${wheel.description}`.toLowerCase();
  // 命中的关键词
  const matchedKeywords = queryKeywords.filter(kw =>
    text.includes(kw.toLowerCase()),
  );

  // 1. 相关度(0~0.5):命中率
  const hitRate = queryKeywords.length > 0
    ? matchedKeywords.length / queryKeywords.length
    : 0;
  const relevanceScore = hitRate * 0.5;

  // 2. 热度(0~0.3):stars 归一化
  // 嵌入式领域 stars 普遍偏低(1k stars 已是主流库),用更小分母让分数合理
  // 例:simplefoc 2886 stars:通用 0.0866 vs 嵌入式 0.289
  //     joshr120 912 stars:通用 0.027 vs 嵌入式 0.091
  const stars = wheel.metrics.stars ?? 0;
  const starsDenominator = domain === 'embedded' ? 3000 : 10000;
  const popularityScore = Math.min(stars / starsDenominator, 1) * 0.3;

  // 3. 活跃度(0~0.2):最近更新 + activity
  const activity = wheel.metrics.activity;
  let activityScore = 0;
  if (activity === 'high') activityScore = 0.2;
  else if (activity === 'medium') activityScore = 0.1;
  else if (activity === 'low') activityScore = 0.05;
  // 兜底:用 lastUpdated 估
  if (activityScore === 0 && wheel.metrics.lastUpdated) {
    const t = Date.parse(wheel.metrics.lastUpdated);
    if (!Number.isNaN(t)) {
      const ageMs = Date.now() - t;
      const oneYear = 365 * 24 * 3600 * 1000;
      if (ageMs <= oneYear) activityScore = 0.2;
      else if (ageMs <= 2 * oneYear) activityScore = 0.1;
    }
  }

  const score = relevanceScore + popularityScore + activityScore;
  const recommendation = gradeRecommendation(score, stars);
  const reason = buildReason(wheel, matchedKeywords, queryKeywords, recommendation);

  return { score, recommendation, reason, matchedKeywords };
}

/** 根据分数和 stars 计算推荐等级。导出供 feedback 调整后重新分级使用。 */
export function gradeRecommendation(score: number, stars: number): Recommendation {
  if (score >= 0.6 && stars >= 1000) return 'highly_recommended';
  if (score >= 0.4) return 'recommended';
  if (score >= 0.2) return 'optional';
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
  recommendation: Recommendation,
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
 * @param domain 识别到的领域(如 'embedded'),影响 stars 归一化分母
 */
export function enrichWithMatch(
  wheels: Wheel[],
  queryKeywords: string[],
  domain?: string | null,
): Wheel[] {
  return wheels.map(w => ({ ...w, match: computeMatch(w, queryKeywords, domain) }));
}
