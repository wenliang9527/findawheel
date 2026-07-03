// tests/tools/findWheelTool.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFindWheelTool } from '../../src/tools/findWheelTool.js';
import type { SourceAdapter, SearchOpts } from '../../src/sources/sourceAdapter.js';
import type { RawResult } from '../../src/normalize/types.js';
import { SourceError } from '../../src/errors.js';

function mockAdapter(name: string, results: RawResult[]): SourceAdapter {
  return {
    name,
    async search(_q: string, _o: SearchOpts): Promise<RawResult[]> { return results; },
  };
}

function failingAdapter(name: string): SourceAdapter {
  return {
    name,
    async search(): Promise<RawResult[]> { throw new SourceError(name, 'down'); },
  };
}

describe('findWheelTool.handle', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns empty query error', async () => {
    const tool = createFindWheelTool({ adapters: [] });
    const res = await tool.handle({ query: '' });
    expect(res.isError).toBe(true);
  });

  it('aggregates results from multiple adapters', async () => {
    // description 包含 query 核心词,否则会被 isMissingCoreConcept 过滤(真实相关结果一定会在描述里提到核心词)
    const gh: RawResult = {
      source: 'github', name: 'a/b', url: 'https://github.com/a/b', description: 'A markdown editor',
      stars: 100, language: null, license: 'MIT', archived: false,
      pushedAt: '2025-06-01T00:00:00Z', topics: [],
    };
    const npm: RawResult = {
      source: 'npm', name: 'pkg', url: 'https://www.npmjs.com/package/pkg',
      description: 'markdown editor library', version: '1.0', keywords: [], date: '2025-06-01T00:00:00Z',
    };
    const tool = createFindWheelTool({
      adapters: [mockAdapter('github', [gh]), mockAdapter('npm', [npm])],
    });
    const res = await tool.handle({ query: 'markdown editor' });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);
    expect(payload.wheels).toHaveLength(2);
    expect(payload.intent).toBe('project');
  });

  it('records degraded sources when one fails', async () => {
    const gh: RawResult = {
      source: 'github', name: 'a/b', url: 'https://github.com/a/b', description: 'd',
      stars: 100, language: null, license: 'MIT', archived: false,
      pushedAt: '2025-06-01T00:00:00Z', topics: [],
    };
    const tool = createFindWheelTool({
      adapters: [mockAdapter('github', [gh]), failingAdapter('npm')],
    });
    const res = await tool.handle({ query: 'x' });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);
    expect(payload.wheels).toHaveLength(1);
    expect(payload.degradedSources).toEqual(['npm']);
  });

  it('returns isError when all adapters fail', async () => {
    const tool = createFindWheelTool({
      adapters: [failingAdapter('github'), failingAdapter('npm')],
    });
    const res = await tool.handle({ query: 'x' });
    expect(res.isError).toBe(true);
  });

  it('returns empty wheels when all sources return 0', async () => {
    const tool = createFindWheelTool({
      adapters: [mockAdapter('github', [])],
    });
    const res = await tool.handle({ query: 'x' });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);
    expect(payload.wheels).toEqual([]);
  });
});
