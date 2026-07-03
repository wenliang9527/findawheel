// src/feedback/feedbackWeighter.ts
// 反馈加权计算: 将用户反馈(like/hide/click)转换为 score 调整量, 叠加到 matchScore 上。
// 策略: 固定分值加减, 累加上限防刷, hide 无上限(强负面信号)。
import type { FeedbackRecord } from './feedbackStore.js';

/** 单次动作的分值 */
export const FEEDBACK_WEIGHTS = {
  like: 0.2,
  click: 0.05,
  hide: -0.5,
} as const;

/** 累加上限(防刷): 正向反馈封顶, 负向不封顶 */
export const FEEDBACK_CAPS = {
  like: 1.0,   // 最多 +1.0 (5 个 like 封顶)
  click: 0.3,  // 最多 +0.3 (6 个 click 封顶)
  // hide 无上限: 用户明确不想要, 扣分越多越好
} as const;

export interface FeedbackWeightResult {
  /** 调整后的 score, 钳制在 [0, 1] */
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
 * - hide: -0.5/次, 无上限(强负面信号)
 * - feedback 为 null(无记录)时, 返回 baseScore 不变
 * - 最终 score 钳制在 [0, 1]
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

  // hide: 无上限
  const hideDelta = feedback.hides * FEEDBACK_WEIGHTS.hide;

  const feedbackDelta = likeDelta + clickDelta + hideDelta;
  // 钳制到 [0, 1]
  const adjustedScore = Math.max(0, Math.min(1, baseScore + feedbackDelta));

  return {
    adjustedScore,
    feedbackDelta,
    breakdown: { likeDelta, clickDelta, hideDelta },
  };
}
