// src/util/recommendation.ts
// 推荐等级分级逻辑(共享层)。
//
// 原先定义在 src/rank/recommender.ts,但 feedback 层需要调用 gradeRecommendation
// 对反馈调整后的 score 重新分级,导致 feedback→rank 的反向依赖(数据流 rank→feedback)。
// 将 gradeRecommendation 及其依赖的常量下沉到 util 共享层,消除反向依赖。
//
// 本模块为纯函数 + 常量,不依赖 rank/feedback 任何模块,只依赖 normalize/types.ts 的类型。

import type { Recommendation, WheelSource } from '../normalize/types.js';

/**
 * highly_recommended 的 stars 阈值(按 source 差异化)。
 * 与 STARS_DENOMINATOR_BY_SOURCE 保持一致(约分母的 10%):
 * - github/gitee/gitlab/librariesio/github-code:真实 stars,阈值 1000(github)/500(gitee/gitlab)
 * - huggingface:likes 量级,阈值 50(顶级模型 likes 几百)
 * - paperswithcode:关联 repo stars 量级小,阈值 100
 * - 其他源:默认 1000(无 stars 时 stars=0 < 1000,不会 highly_recommended)
 */
const HIGHLY_RECOMMENDED_STARS_BY_SOURCE: Partial<Record<WheelSource, number>> = {
  github: 1000,
  gitee: 500,
  gitlab: 500,
  librariesio: 1000,
  huggingface: 50,
  'github-code': 1000,
  paperswithcode: 100,
};

const DEFAULT_HIGHLY_RECOMMENDED_STARS = 1000;

function getHighlyRecommendedStarsThreshold(source?: WheelSource): number {
  if (!source) return DEFAULT_HIGHLY_RECOMMENDED_STARS;
  return HIGHLY_RECOMMENDED_STARS_BY_SOURCE[source] ?? DEFAULT_HIGHLY_RECOMMENDED_STARS;
}

/**
 * 推荐等级阈值常量(gradeRecommendation 用)。
 * 集中管理避免散落在多处导致不一致。
 *
 * 等级定义:
 * - highly_recommended: score >= 0.6 且 stars 达到 source 对应阈值(高分且具备主流热度)
 * - recommended:        score >= 0.4(相关度较好)
 * - optional:           score >= 0.2(弱相关,可备选)
 * - not_recommended:    score < 0.2(不推荐)
 */
const HIGHLY_RECOMMENDED_SCORE = 0.6;
const RECOMMENDED_SCORE = 0.4;
const OPTIONAL_SCORE = 0.2;

/** 根据分数和 stars 计算推荐等级。导出供 feedback 调整后重新分级使用。
 *  source(可选):按 source 差异化 stars 阈值,解决非 GitHub 源 stars 量级不同导致永远达不到 highly_recommended 的问题。
 *  不传 source 时回退到默认阈值 1000(向后兼容)。 */
export function gradeRecommendation(score: number, stars: number, source?: WheelSource): Recommendation {
  const starsThreshold = getHighlyRecommendedStarsThreshold(source);
  if (score >= HIGHLY_RECOMMENDED_SCORE && stars >= starsThreshold) return 'highly_recommended';
  if (score >= RECOMMENDED_SCORE) return 'recommended';
  if (score >= OPTIONAL_SCORE) return 'optional';
  return 'not_recommended';
}
