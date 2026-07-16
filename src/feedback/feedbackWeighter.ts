// src/feedback/feedbackWeighter.ts
// 反馈加权计算: 将用户反馈(like/hide/click)转换为 score 调整量,叠加到 matchScore 上。
// 策略: 固定分值加减, 累加上限防刷(含 hide 上限, 避免误操作永久降权)。
import type { FeedbackRecord } from './feedbackStore.js';
import type { Wheel } from '../normalize/types.js';
import { gradeRecommendation } from '../util/recommendation.js';

/** 单次动作的分值 */
export const FEEDBACK_WEIGHTS = {
  like: 0.2,
  click: 0.05,
  hide: -0.5,
} as const;

/**
 * 累加上限(防刷): 正向和负向反馈都封顶。
 * N9:hide 增加上限 -1.0(与 like 上限 +1.0 对称)。
 * 原逻辑 hide 无上限,3 次 hide = -1.5 会把任何项目压到最低,
 * 且无 unhide 机制,误操作后需 5 次 like 才能抵消。
 * 改为 -1.0 后,1 次 hide(-0.5)仍能显著降权,但极端压制受限,
 * 与 like 上限对称,更符合"反馈是调整而非屏蔽"的设计理念。
 */
export const FEEDBACK_CAPS = {
  like: 1.0,   // 最多 +1.0 (5 个 like 封顶)
  click: 0.3,  // 最多 +0.3 (6 个 click 封顶)
  hide: -1.0,  // N9:最多 -1.0 (2 个 hide 封顶,避免极端压制)
} as const;

/**
 * score 钳制边界(与 recommender 实际上限 1.1 + 0.4 反馈空间对齐,见下方 applyFeedbackScore 注释)。
 * 集中到模块顶部常量,避免在多处硬编码 0 / 1.5 导致漂移。
 */
const SCORE_MIN = 0;
const SCORE_MAX = 1.5;

export interface FeedbackWeightResult {
  /** 调整后的 score, 钳制在 [0, 1.5] */
  adjustedScore: number;
  /** 反馈带来的调整量(可正可负), 用于调试/展示 */
  feedbackDelta: number;
  /** 分项明细(用于审计/调试) */
  breakdown: {
    likeDelta: number;
    clickDelta: number;
    hideDelta: number;
  };
}

/**
 * 计算反馈对 score 的调整。
 * - like: +0.2/次, 累加上限 +1.0
 * - click: +0.05/次, 累加上限 +0.3
 * - hide: -0.5/次, 累加上限 -1.0 (N9:避免误操作极端压制)
 * - feedback 为 null(无记录)时, 返回 baseScore 不变
 * - 最终 score 钳制在 [0, 1.5]
 *
 * 钳制上限说明:
 * recommender 的 matchScore 实际上限是 1.1(相关度 0.6 + 热度 0.3 + 活跃度 0.2),
 * 加上正向反馈累加上限 +1.0, 理论最高 2.1。但实际场景中:
 * - base 能到 1.1 的 wheel 通常是 stars 1w+ 的热门项目,用户点赞属锦上添花
 * - 把上限设为 1.5 而非 2.1,既保留正反馈的相对排序提升,又避免少数热门项目
 *   因反馈累积而把分数推到天文数字,导致冷门但匹配的 wheel 永远排不上来
 * - 1.5 = 1.1(满分) + 0.4(约 2 个 like 的提升空间),与 recommender 上限成比例
 */
export function applyFeedbackScore(
  baseScore: number,
  feedback: FeedbackRecord | null,
): FeedbackWeightResult {
  if (!feedback) {
    return {
      adjustedScore: baseScore,
      feedbackDelta: 0,
      breakdown: { likeDelta: 0, clickDelta: 0, hideDelta: 0 },
    };
  }

  // like: 累加上限
  const likeRaw = feedback.likes * FEEDBACK_WEIGHTS.like;
  const likeDelta = Math.min(likeRaw, FEEDBACK_CAPS.like);

  // click: 累加上限
  const clickRaw = feedback.clicks * FEEDBACK_WEIGHTS.click;
  const clickDelta = Math.min(clickRaw, FEEDBACK_CAPS.click);

  // hide: N9 累加上限 -1.0(与 like +1.0 对称,避免极端压制)
  const hideRaw = feedback.hides * FEEDBACK_WEIGHTS.hide;
  const hideDelta = Math.max(hideRaw, FEEDBACK_CAPS.hide);  // 负值取 max(更接近 0)

  const feedbackDelta = likeDelta + clickDelta + hideDelta;
  // 钳制到 [SCORE_MIN, SCORE_MAX](与 recommender 实际上限 1.1 + 0.4 反馈空间对齐)
  const adjustedScore = Math.max(SCORE_MIN, Math.min(SCORE_MAX, baseScore + feedbackDelta));

  return {
    adjustedScore,
    feedbackDelta,
    breakdown: { likeDelta, clickDelta, hideDelta },
  };
}

/**
 * 批量对 Wheel 列表应用 feedback 加权, 重新排序并重新分级。
 *
 * 流程:
 * 1. 对每个 wheel 查 feedbackMap, 调 applyFeedbackScore 调整 matchScore
 * 2. 更新 wheel.match.score = adjustedScore, 填 feedbackDelta
 * 3. 用调整后 score 重新计算 recommendation 等级 (gradeRecommendation)
 * 4. 按 adjustedScore 降序重新排序
 *
 * @param wheels 已 enrichWithMatch 的 wheel 列表
 * @param feedbackMap name → FeedbackRecord 索引 (由 getAllFeedback 构建)
 * @returns 调整并重排后的新数组 (不修改原数组)
 */
export function applyFeedbackToWheels(
  wheels: Wheel[],
  feedbackMap: Map<string, FeedbackRecord>,
): Wheel[] {
  if (feedbackMap.size === 0) return wheels;

  const adjusted = wheels.map(w => {
    if (!w.match) return w;
    // N5:用 toLowerCase 查询(与 findWheelTool.applyFeedback 构建 feedbackMap 时的 key 归一化一致),
    // 避免 feedback 存 "Lodash" 而 wheel.name 是 "lodash" 时 get 不命中导致反馈失效
    const feedback = feedbackMap.get(w.name.toLowerCase()) ?? null;
    // 无反馈记录: 不调整
    if (!feedback) return w;
    const result = applyFeedbackScore(w.match.score, feedback);
    const stars = w.metrics.stars ?? 0;
    return {
      ...w,
      match: {
        ...w.match,
        score: result.adjustedScore,
        feedbackDelta: result.feedbackDelta,
        recommendation: gradeRecommendation(result.adjustedScore, stars),
      },
    };
  });

  // 按调整后 score 降序排序
  return adjusted.sort((a, b) => {
    const sa = a.match?.score ?? 0;
    const sb = b.match?.score ?? 0;
    return sb - sa;
  });
}
