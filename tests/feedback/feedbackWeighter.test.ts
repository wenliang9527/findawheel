// tests/feedback/feedbackWeighter.test.ts
import { describe, it, expect } from 'vitest';
import {
  applyFeedbackScore,
  FEEDBACK_WEIGHTS,
  FEEDBACK_CAPS,
} from '../../src/feedback/feedbackWeighter.js';
import type { FeedbackRecord } from '../../src/feedback/feedbackStore.js';

function makeRecord(overrides: Partial<FeedbackRecord> = {}): FeedbackRecord {
  return {
    name: 'a/b',
    source: 'github',
    likes: 0,
    hides: 0,
    clicks: 0,
    lastUpdated: Date.now(),
    lastAction: 'like',
    ...overrides,
  };
}

describe('applyFeedbackScore', () => {
  it('returns baseScore unchanged when feedback is null', () => {
    const result = applyFeedbackScore(0.5, null);
    expect(result.adjustedScore).toBe(0.5);
    expect(result.feedbackDelta).toBe(0);
    expect(result.breakdown).toEqual({ likeDelta: 0, clickDelta: 0, hideDelta: 0 });
  });

  it('returns baseScore unchanged when all counts are 0', () => {
    const result = applyFeedbackScore(0.5, makeRecord());
    expect(result.adjustedScore).toBe(0.5);
    expect(result.feedbackDelta).toBe(0);
  });

  it('adds +0.2 for single like', () => {
    const result = applyFeedbackScore(0.5, makeRecord({ likes: 1 }));
    expect(result.adjustedScore).toBeCloseTo(0.7, 5);
    expect(result.feedbackDelta).toBeCloseTo(0.2, 5);
    expect(result.breakdown.likeDelta).toBeCloseTo(0.2, 5);
  });

  it('adds +0.05 for single click', () => {
    const result = applyFeedbackScore(0.5, makeRecord({ clicks: 1 }));
    expect(result.adjustedScore).toBeCloseTo(0.55, 5);
    expect(result.feedbackDelta).toBeCloseTo(0.05, 5);
  });

  it('subtracts -0.5 for single hide', () => {
    const result = applyFeedbackScore(0.5, makeRecord({ hides: 1 }));
    expect(result.adjustedScore).toBe(0);
    expect(result.feedbackDelta).toBeCloseTo(-0.5, 5);
  });

  it('accumulates likes: 3 likes = +0.6', () => {
    const result = applyFeedbackScore(0.2, makeRecord({ likes: 3 }));
    expect(result.adjustedScore).toBeCloseTo(0.8, 5);
    expect(result.feedbackDelta).toBeCloseTo(0.6, 5);
  });

  it('caps like delta at +1.0 (5 likes = +1.0, 10 likes still +1.0)', () => {
    const r1 = applyFeedbackScore(0.0, makeRecord({ likes: 5 }));
    expect(r1.feedbackDelta).toBeCloseTo(1.0, 5);
    const r2 = applyFeedbackScore(0.0, makeRecord({ likes: 10 }));
    expect(r2.feedbackDelta).toBeCloseTo(1.0, 5);
  });

  it('caps click delta at +0.3 (6 clicks = +0.3, 20 clicks still +0.3)', () => {
    const r1 = applyFeedbackScore(0.0, makeRecord({ clicks: 6 }));
    expect(r1.feedbackDelta).toBeCloseTo(0.3, 5);
    const r2 = applyFeedbackScore(0.0, makeRecord({ clicks: 20 }));
    expect(r2.feedbackDelta).toBeCloseTo(0.3, 5);
  });

  it('hide has no cap: 5 hides = -2.5', () => {
    const result = applyFeedbackScore(0.5, makeRecord({ hides: 5 }));
    expect(result.feedbackDelta).toBeCloseTo(-2.5, 5);
    expect(result.adjustedScore).toBe(0); // 钳制到 0
  });

  it('combines like + click + hide', () => {
    // likes:3 = +0.6, clicks:2 = +0.1, hides:1 = -0.5 → delta = +0.2
    const result = applyFeedbackScore(0.4, makeRecord({ likes: 3, clicks: 2, hides: 1 }));
    expect(result.breakdown.likeDelta).toBeCloseTo(0.6, 5);
    expect(result.breakdown.clickDelta).toBeCloseTo(0.1, 5);
    expect(result.breakdown.hideDelta).toBeCloseTo(-0.5, 5);
    expect(result.feedbackDelta).toBeCloseTo(0.2, 5);
    expect(result.adjustedScore).toBeCloseTo(0.6, 5);
  });

  it('clamps adjustedScore to [0, 1]', () => {
    // 正向超上限: base 0.9 + 大量 like → 钳制到 1.0
    const high = applyFeedbackScore(0.9, makeRecord({ likes: 10 }));
    expect(high.adjustedScore).toBe(1.0);
    // 负向超下限: base 0.1 + 大量 hide → 钳制到 0
    const low = applyFeedbackScore(0.1, makeRecord({ hides: 10 }));
    expect(low.adjustedScore).toBe(0);
  });

  it('exported weights match spec', () => {
    expect(FEEDBACK_WEIGHTS.like).toBe(0.2);
    expect(FEEDBACK_WEIGHTS.click).toBe(0.05);
    expect(FEEDBACK_WEIGHTS.hide).toBe(-0.5);
  });

  it('exported caps match spec', () => {
    expect(FEEDBACK_CAPS.like).toBe(1.0);
    expect(FEEDBACK_CAPS.click).toBe(0.3);
  });

  it('like cap takes precedence over raw accumulation', () => {
    // 3 likes raw = 0.6, 未触上限
    expect(applyFeedbackScore(0, makeRecord({ likes: 3 })).breakdown.likeDelta).toBeCloseTo(0.6, 5);
    // 6 likes raw = 1.2, 触上限 1.0
    expect(applyFeedbackScore(0, makeRecord({ likes: 6 })).breakdown.likeDelta).toBeCloseTo(1.0, 5);
  });
});
