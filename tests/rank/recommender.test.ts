// tests/rank/recommender.test.ts
import { describe, it, expect } from 'vitest';
import { computeMatch, enrichWithMatch } from '../../src/rank/recommender.js';
import type { Wheel } from '../../src/normalize/types.js';

function makeWheel(over: Partial<Wheel> = {}): Wheel {
  return {
    name: 'x', source: 'github', url: 'https://github.com/x/x',
    description: 'desc', type: 'project',
    metrics: { stars: 100, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false, activity: 'high' },
    ...over,
  };
}

describe('computeMatch', () => {
  const keywords = ['ai', 'coding', 'monitor', 'status'];

  it('highly recommended: high match + high stars + active', () => {
    const w = makeWheel({
      name: 'ai-monitor',
      description: 'Monitor AI coding assistant status in real time',
      metrics: { stars: 5000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false, activity: 'high' },
    });
    const m = computeMatch(w, keywords);
    // 命中 ai/coding/monitor/status 全部 4 个 → 相关度 0.5
    // stars 5000 → 0.15
    // activity high → 0.2
    // total >= 0.6 且 stars >= 1000 → highly_recommended
    expect(m.recommendation).toBe('highly_recommended');
    expect(m.matchedKeywords).toEqual(expect.arrayContaining(['ai', 'coding', 'monitor', 'status']));
    expect(m.reason).toContain('高度匹配');
    expect(m.reason).toContain('活跃维护');
  });

  it('recommended: medium match', () => {
    const w = makeWheel({
      name: 'dev-tracker',
      description: 'A tracker for coding sessions',
      metrics: { stars: 200, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false, activity: 'medium' },
    });
    const m = computeMatch(w, keywords);
    // 命中 coding 1 个 → 相关度 0.125
    // stars 200 → 0.006
    // activity medium → 0.1
    // total ~0.23 → optional(注意:不是 recommended,因为分不够)
    expect(m.score).toBeGreaterThanOrEqual(0.2);
    expect(m.recommendation).toBe('optional');
  });

  it('not recommended: zero hit', () => {
    const w = makeWheel({
      name: 'voicebox',
      description: 'The open-source AI voice studio',
      metrics: { stars: 0, lastUpdated: '2025-01-01T00:00:00Z', archived: false, activity: 'high' },
    });
    const m = computeMatch(w, keywords);
    // 只命中 ai 1 个,且 stars=0
    expect(m.matchedKeywords).toEqual(['ai']);
    expect(m.score).toBeLessThan(0.4);
  });

  it('reason includes star count and activity', () => {
    const w = makeWheel({
      description: 'Monitor AI coding status',
      metrics: { stars: 12000, lastUpdated: '2025-01-01T00:00:00Z', license: 'Apache-2.0', archived: false, activity: 'high' },
    });
    const m = computeMatch(w, keywords);
    expect(m.reason).toContain('12.0k stars');
    expect(m.reason).toContain('活跃维护');
    expect(m.reason).toContain('Apache-2.0');
  });

  it('empty keywords returns zero relevance', () => {
    const w = makeWheel({ description: 'anything' });
    const m = computeMatch(w, []);
    expect(m.matchedKeywords).toEqual([]);
    expect(m.score).toBeLessThan(0.5); // 只有热度+活跃度,无相关度
  });
});

describe('enrichWithMatch', () => {
  it('fills match field on every wheel', () => {
    const wheels = [
      makeWheel({ name: 'a', description: 'Monitor AI coding' }),
      makeWheel({ name: 'b', description: 'unrelated' }),
    ];
    const enriched = enrichWithMatch(wheels, ['ai', 'coding', 'monitor']);
    expect(enriched).toHaveLength(2);
    expect(enriched[0].match).toBeDefined();
    expect(enriched[1].match).toBeDefined();
    expect(enriched[0].match!.matchedKeywords.length).toBeGreaterThan(0);
  });
});

// ===== Phase 5 新增:嵌入式领域 stars 归一化调整 =====
describe('computeMatch - embedded domain', () => {
  const embeddedKeywords = ['stepper', 'motor', 'driver'];

  it('uses smaller stars denominator for embedded domain', () => {
    // 912 stars 的嵌入式库,通用领域 stars/10000=0.027,嵌入式领域 stars/3000=0.091
    const w = makeWheel({
      name: 'joshr120/PD-Stepper',
      description: 'Stepper motor driver for Arduino',
      metrics: { stars: 912, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false, activity: 'high' },
    });
    const mGeneral = computeMatch(w, embeddedKeywords, null);
    const mEmbedded = computeMatch(w, embeddedKeywords, 'embedded');
    // 两个都命中全部 3 个关键词,hitRate=1.0
    // 通用: 0.5 + 912/10000*0.3 + 0.2 = 0.5 + 0.027 + 0.2 = 0.727
    // 嵌入式: 0.5 + 912/3000*0.3 + 0.2 = 0.5 + 0.0912 + 0.2 = 0.791
    expect(mEmbedded.score).toBeGreaterThan(mGeneral.score);
    expect(mGeneral.score).toBeCloseTo(0.5 + 0.027 + 0.2, 2);
    expect(mEmbedded.score).toBeCloseTo(0.5 + 0.0912 + 0.2, 2);
  });

  it('embedded domain boosts 912-star library to recommended', () => {
    // joshr120/PD-Stepper(912 stars)在嵌入式领域应升到 recommended
    const w = makeWheel({
      name: 'joshr120/PD-Stepper',
      description: 'Stepper motor driver for Arduino',
      metrics: { stars: 912, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false, activity: 'high' },
    });
    const m = computeMatch(w, embeddedKeywords, 'embedded');
    // score 0.791 >= 0.4 → recommended(stars < 1000 不能 highly_recommended)
    expect(m.recommendation).toBe('recommended');
  });

  it('embedded domain boosts 2886-star library to highly_recommended', () => {
    // simplefoc/Arduino-FOC(2886 stars)在嵌入式领域应升到 highly_recommended
    const w = makeWheel({
      name: 'simplefoc/Arduino-FOC',
      description: 'Stepper motor FOC driver',
      metrics: { stars: 2886, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false, activity: 'high' },
    });
    const m = computeMatch(w, embeddedKeywords, 'embedded');
    // score = 0.5 + 2886/3000*0.3 + 0.2 = 0.5 + 0.2886 + 0.2 = 0.989
    // stars 2886 >= 1000 → highly_recommended
    expect(m.recommendation).toBe('highly_recommended');
  });

  it('non-embedded domain uses default 10000 denominator', () => {
    // 同一个 912 stars 的库,非嵌入式领域用 stars/10000
    const w = makeWheel({
      name: 'some-lib',
      description: 'Stepper motor driver',
      metrics: { stars: 912, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false, activity: 'high' },
    });
    const m = computeMatch(w, embeddedKeywords, null);
    // score = 0.5 + 912/10000*0.3 + 0.2 = 0.727 → recommended
    // 但如果 hitRate 低,非嵌入式领域可能只到 optional
    expect(m.score).toBeCloseTo(0.5 + 0.027 + 0.2, 2);
  });
});

describe('enrichWithMatch - embedded domain', () => {
  it('passes domain to computeMatch for all wheels', () => {
    const wheels = [
      makeWheel({
        name: 'a/stepper-lib',
        description: 'Stepper motor driver',
        metrics: { stars: 500, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false, activity: 'high' },
      }),
    ];
    const enriched = enrichWithMatch(wheels, ['stepper', 'motor', 'driver'], 'embedded');
    expect(enriched[0].match).toBeDefined();
    // 500 stars 嵌入式: 0.5 + 500/3000*0.3 + 0.2 = 0.5 + 0.05 + 0.2 = 0.75
    expect(enriched[0].match!.score).toBeCloseTo(0.5 + 0.05 + 0.2, 2);
  });
});
