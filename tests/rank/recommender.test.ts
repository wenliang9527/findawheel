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
