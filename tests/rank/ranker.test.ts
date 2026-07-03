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
});

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
});
