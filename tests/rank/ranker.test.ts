// tests/rank/ranker.test.ts
import { describe, it, expect } from 'vitest';
import { rank, filterOut, score, dedupe } from '../../src/rank/ranker.js';
import type { Wheel } from '../../src/normalize/types.js';

function makeWheel(over: Partial<Wheel> = {}): Wheel {
  return {
    name: 'x', source: 'github', url: 'https://github.com/x/x',
    description: 'desc', type: 'project',
    metrics: { stars: 100, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false },
    ...over,
  };
}

describe('filterOut', () => {
  it('removes archived', () => {
    const w = makeWheel({ metrics: { archived: true } });
    expect(filterOut(w)).toBe(true);
  });
  it('removes lastUpdated older than 3 years', () => {
    const w = makeWheel({ metrics: { lastUpdated: '2020-01-01T00:00:00Z' } });
    expect(filterOut(w)).toBe(true);
  });
  it('removes empty description with stars < 10', () => {
    const w = makeWheel({ description: '', metrics: { stars: 5 } });
    expect(filterOut(w)).toBe(true);
  });
  it('keeps active repo with description', () => {
    expect(filterOut(makeWheel())).toBe(false);
  });
  it('removes awesome-xxx aggregate repos', () => {
    const w = makeWheel({ name: 'awesome-python', description: 'A curated list of Python packages' });
    expect(filterOut(w)).toBe(true);
  });
  it('removes public-apis aggregate repos', () => {
    const w = makeWheel({ name: 'public-apis', description: 'A collective list of free APIs' });
    expect(filterOut(w)).toBe(true);
  });
});

describe('score', () => {
  it('higher stars scores higher', () => {
    const low = score(makeWheel({ metrics: { stars: 10 } }), 'project');
    const high = score(makeWheel({ metrics: { stars: 30000 } }), 'project');
    expect(high).toBeGreaterThan(low);
  });
  it('feature intent boosts downloads weight', () => {
    const w = makeWheel({ source: 'crates', type: 'package', metrics: { downloads: 80000 } });
    const f = score(w, 'feature');
    const p = score(w, 'project');
    expect(f).toBeGreaterThan(p);
  });
  it('description matching query keywords gets bonus', () => {
    const noMatch = makeWheel({ description: 'A file upload library', metrics: { stars: 1000 } });
    const match = makeWheel({ description: 'Image watermark tool', name: 'watermark', metrics: { stars: 1000 } });
    const sNo = score(noMatch, 'project', ['image', 'watermark']);
    const sYes = score(match, 'project', ['image', 'watermark']);
    expect(sYes).toBeGreaterThan(sNo);
  });
  it('higher query coverage scores higher', () => {
    // 全词覆盖率高的项目应排在覆盖率低的前面
    const lowCoverage = makeWheel({ description: 'A watermark library', metrics: { stars: 1000 } });
    const highCoverage = makeWheel({ description: 'Add invisible watermark to images with encryption', metrics: { stars: 1000 } });
    const sLow = score(lowCoverage, 'project', ['invisible', 'watermark', 'encryption', 'image']);
    const sHigh = score(highCoverage, 'project', ['invisible', 'watermark', 'encryption', 'image']);
    expect(sHigh).toBeGreaterThan(sLow);
  });
  it('zero-hit high-star project is penalized', () => {
    // voicebox 场景:高 star 但零命中,应被降权,排不过低 star 但命中的项目
    const zeroHitHighStar = makeWheel({
      name: 'voicebox', description: 'The open-source AI voice studio',
      metrics: { stars: 37000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false },
    });
    const hitLowStar = makeWheel({
      name: 'ai-monitor', description: 'Monitor AI coding assistant status',
      metrics: { stars: 100, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false },
    });
    const keywords = ['ai', 'coding', 'monitor', 'status', 'tracking'];
    const sZero = score(zeroHitHighStar, 'feature', keywords);
    const sHit = score(hitLowStar, 'feature', keywords);
    expect(sHit).toBeGreaterThan(sZero);
  });
});

// Phase 6 简化:删除 isReverseIntent 和 isMissingCoreConcept 的测试。
// 这两个过滤函数已删除 —— 相关性判断交给 AI 调用方,不再用硬规则过滤。

describe('dedupe', () => {
  it('merges same name keeping richer metrics', () => {
    const a = makeWheel({ name: 'lodash', source: 'npm', metrics: { lastUpdated: '2025-01-01T00:00:00Z' } });
    const b = makeWheel({ name: 'lodash', source: 'github', metrics: { stars: 50000, lastUpdated: '2025-01-01T00:00:00Z' } });
    const out = dedupe([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].metrics.stars).toBe(50000);
  });
});

describe('rank', () => {
  it('filters then sorts by score desc and applies limit', () => {
    const bad = makeWheel({ name: 'bad', metrics: { archived: true } });
    const good = makeWheel({ name: 'good', metrics: { stars: 40000 } });
    const mid = makeWheel({ name: 'mid', metrics: { stars: 100 } });
    const out = rank([bad, mid, good], 'project', 10);
    expect(out.map(w => w.name)).toEqual(['good', 'mid']);
  });

  // Phase 6 简化:rank 不再做核心词必命中过滤。
  // 之前测试断言 react-image-crop 被过滤 —— 现在不过滤了,
  // AI 调用方看到结果后自己判断裁剪工具不相关。
  it('does NOT filter out unrelated results (judgment delegated to AI)', () => {
    // 搜 "invisible image watermark encryption" 时,裁剪工具虽然不相关,
    // 但 findawheel 不再硬过滤 —— 交给 AI 调用方判断。
    const cropTool = makeWheel({
      name: 'react-image-crop',
      description: 'A responsive image cropping tool',
      metrics: { stars: 30000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false },
    });
    const watermarkTool = makeWheel({
      name: 'blind-watermark-wasm',
      description: 'Add invisible watermark to images',
      metrics: { stars: 500, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false },
    });
    const out = rank([cropTool, watermarkTool], 'feature', 10, ['watermark', 'image']);
    // 两个结果都应保留(findawheel 不过滤,AI 自己判断)
    expect(out.map(w => w.name)).toContain('react-image-crop');
    expect(out.map(w => w.name)).toContain('blind-watermark-wasm');
  });
});
