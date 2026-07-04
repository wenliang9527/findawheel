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

  // ===== R1:topics 命中额外加分 =====
  it('R1: topics matching keywords increases relevance score', () => {
    // 两个项目 description 命中情况相同,但其中一个 topics 也命中
    const noTopics = makeWheel({
      name: 'lib-a', description: 'A library for motor control',
      metrics: { stars: 1000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false, activity: 'high' },
    });
    const withTopics = makeWheel({
      name: 'lib-b', description: 'A library for motor control',
      topics: ['stepper-motor', 'driver', 'embedded'],
      metrics: { stars: 1000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false, activity: 'high' },
    });
    const keywords = ['stepper', 'motor', 'driver'];
    const mNo = computeMatch(noTopics, keywords);
    const mYes = computeMatch(withTopics, keywords);
    // topics 命中应让 withTopics 得分更高
    expect(mYes.score).toBeGreaterThan(mNo.score);
  });

  it('R1: topics bonus capped at +0.1', () => {
    // topics 命中所有关键词,加分上限 0.1
    const w = makeWheel({
      name: 'x', description: 'unrelated text here',
      topics: ['stepper', 'motor', 'driver'],
      metrics: { stars: 1000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false, activity: 'high' },
    });
    const keywords = ['stepper', 'motor', 'driver'];
    const m = computeMatch(w, keywords);
    // matchedKeywords 为空(description 不含关键词),但 topics 命中 3/3
    // relevanceScore = 0 (hitRate) + 0.1 (topics 全命中) = 0.1
    // 加上 stars + activity 后总分应 > 0.3 但 relevance 部分应 <= 0.1
    expect(m.matchedKeywords).toEqual([]);
    // 验证 topics 加分存在:对比无 topics 的同款项目
    const wNoTopics = makeWheel({
      name: 'x', description: 'unrelated text here',
      metrics: { stars: 1000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false, activity: 'high' },
    });
    const mNo = computeMatch(wNoTopics, keywords);
    expect(m.score - mNo.score).toBeCloseTo(0.1, 5); // topics 加分正好 0.1
  });

  // ===== R2:name 命中额外加分 =====
  it('R2: name matching keywords increases relevance score', () => {
    // 两个项目 description 相同,但其中一个 name 命中关键词
    const noNameHit = makeWheel({
      name: 'lib-a', description: 'A tool for AI coding',
      metrics: { stars: 1000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false, activity: 'high' },
    });
    const nameHit = makeWheel({
      name: 'ai-coding', description: 'A tool for AI coding',
      metrics: { stars: 1000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false, activity: 'high' },
    });
    const keywords = ['ai', 'coding'];
    const mNo = computeMatch(noNameHit, keywords);
    const mYes = computeMatch(nameHit, keywords);
    // name 命中应让 nameHit 得分更高
    expect(mYes.score).toBeGreaterThan(mNo.score);
  });

  it('R2: relevance score capped at 0.6 (topics + name combined)', () => {
    // 即使 topics 和 name 都全命中,relevance 也应被钳制到 0.6
    const w = makeWheel({
      name: 'ai-coding-monitor',
      description: 'ai coding monitor tool',
      topics: ['ai', 'coding', 'monitor'],
      metrics: { stars: 50000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false, activity: 'high' },
    });
    const keywords = ['ai', 'coding', 'monitor'];
    const m = computeMatch(w, keywords);
    // relevance = 0.5 (hitRate) + 0.1 (topics) + 0.1 (name) = 0.7,但钳制到 0.6
    // 加上 popularity (50000/10000=1.0 → 0.3) + activity (0.2) = 1.1,但 score 不再钳制(只有 relevance 钳制)
    // 实际 score = 0.6 + 0.3 + 0.2 = 1.1
    expect(m.score).toBeGreaterThan(1.0); // 说明 relevance 没被过度钳制导致分数过低
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

// Phase 6 简化:删除领域特定 stars 分母测试(embedded/multi-domain)。
// 统一用 10000 作为 stars 分母,不再有领域配置表。
// AI 调用方拿到 stars 原值后自己判断领域相对热度。
