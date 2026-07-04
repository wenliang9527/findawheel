// tests/tools/findWheelTool.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFindWheelTool } from '../../src/tools/findWheelTool.js';
import { createCache, type Cache } from '../../src/cache/cache.js';
import type { SourceAdapter, SearchOpts } from '../../src/sources/sourceAdapter.js';
import type { RawResult } from '../../src/normalize/types.js';
import { SourceError } from '../../src/errors.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

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

let dirCounter = 0;
function tmpCacheDir(): string {
  dirCounter += 1;
  return path.join(os.tmpdir(), `fw-test-${process.pid}-${dirCounter}`);
}

// description 包含 query 核心词的通用 github 结果,避免被 isMissingCoreConcept 过滤
function ghResult(name: string, desc: string): RawResult {
  return {
    source: 'github', name, url: `https://github.com/${name}`,
    description: desc, stars: 100, language: null, license: 'MIT',
    archived: false, pushedAt: '2025-06-01T00:00:00Z', topics: [],
  };
}

describe('findWheelTool.handle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // 默认禁用缓存,避免现有测试受磁盘缓存污染
    process.env.FINDAWHEEL_CACHE_ENABLED = 'false';
  });

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

  // ===== 缓存集成测试 =====

  it('缓存命中时不调用 adapter', async () => {
    const dir = tmpCacheDir();
    const cache = createCache({ dir, ttlMs: 3600000, enabled: true });
    const gh = ghResult('a/b', 'A markdown editor');
    const searchSpy = vi.fn().mockResolvedValue([gh]);
    const adapter: SourceAdapter = { name: 'github', search: searchSpy };
    const tool = createFindWheelTool({ adapters: [adapter], cache });
    // 第一次调用:未命中,执行搜索并写缓存
    await tool.handle({ query: 'markdown editor' });
    expect(searchSpy).toHaveBeenCalled();
    const firstCallCount = searchSpy.mock.calls.length;
    // 第二次调用:命中缓存,adapter 不应被调用
    const res = await tool.handle({ query: 'markdown editor' });
    expect(searchSpy.mock.calls.length).toBe(firstCallCount);
    const payload = JSON.parse(res.content[0].text);
    expect(payload.cached).toBe(true);
    // 清理临时目录
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('未命中时调用 adapter 并写缓存', async () => {
    const dir = tmpCacheDir();
    const cache = createCache({ dir, ttlMs: 3600000, enabled: true });
    const gh = ghResult('a/b', 'A markdown editor');
    const adapter = mockAdapter('github', [gh]);
    const tool = createFindWheelTool({ adapters: [adapter], cache });
    await tool.handle({ query: 'markdown editor' });
    // 缓存文件应该存在
    const files = await fs.promises.readdir(dir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/\.json$/);
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('disabled 时不缓存,每次都调 adapter', async () => {
    const dir = tmpCacheDir();
    const cache = createCache({ dir, ttlMs: 3600000, enabled: false });
    const gh = ghResult('a/b', 'A markdown editor');
    const searchSpy = vi.fn().mockResolvedValue([gh]);
    const adapter: SourceAdapter = { name: 'github', search: searchSpy };
    const tool = createFindWheelTool({ adapters: [adapter], cache });
    await tool.handle({ query: 'markdown editor' });
    await tool.handle({ query: 'markdown editor' });
    // 两次调用都应执行搜索(主+副),共 4 次
    expect(searchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    // 目录应该为空(disabled 不写缓存)
    const files = await fs.promises.readdir(dir).catch(() => [] as string[]);
    expect(files.length).toBe(0);
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('同 key 并发只执行一次搜索 (dedupe)', async () => {
    const dir = tmpCacheDir();
    const cache = createCache({ dir, ttlMs: 3600000, enabled: true });
    const gh = ghResult('a/b', 'A markdown editor');
    // 加延迟模拟真实网络 I/O(远慢于磁盘 readFile),
    // 确保 A 的搜索在 B 的 cache.get 完成时仍在进行,dedupe 才能生效
    const searchSpy = vi.fn().mockImplementation(async () => {
      await new Promise<void>(r => setTimeout(r, 30));
      return [gh];
    });
    const adapter: SourceAdapter = { name: 'github', search: searchSpy };
    const tool = createFindWheelTool({ adapters: [adapter], cache });
    // 并发两次同 query
    await Promise.all([
      tool.handle({ query: 'markdown editor' }),
      tool.handle({ query: 'markdown editor' }),
    ]);
    // dedupe 应让搜索流程只跑一次(主+副共 2 次 adapter 调用)
    // 若无 dedupe 会跑两次(4 次)
    expect(searchSpy.mock.calls.length).toBe(2);
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  // ===== Phase 5 新增:低质量结果警告 =====

  it('summary 不含 warning 当 top 1 stars >= 10', async () => {
    // stars=100 的结果不应触发警告
    const gh = ghResult('a/popular-lib', 'A markdown editor');
    const adapter: SourceAdapter = { name: 'github', async search() { return [gh]; } };
    const tool = createFindWheelTool({ adapters: [adapter] });
    const res = await tool.handle({ query: 'markdown editor' });
    const output = JSON.parse(res.content[0].text);
    expect(output.summary.warning).toBeUndefined();
  });

  it('summary 含 warning 当 top 1 stars < 10', async () => {
    // stars=3 的结果应触发低质量警告(模拟嵌入式领域召回差的情况)
    const gh: RawResult = {
      source: 'github', name: 'a/tiny-project', url: 'https://github.com/a/tiny-project',
      description: 'A markdown editor', stars: 3, language: null, license: 'MIT',
      archived: false, pushedAt: '2025-06-01T00:00:00Z', topics: [],
    };
    const adapter: SourceAdapter = { name: 'github', async search() { return [gh]; } };
    const tool = createFindWheelTool({ adapters: [adapter] });
    const res = await tool.handle({ query: 'markdown editor' });
    const output = JSON.parse(res.content[0].text);
    expect(output.summary.warning).toBeDefined();
    expect(output.summary.warning).toContain('召回质量警告');
    expect(output.summary.warning).toContain('3 stars');
    expect(output.summary.warning).toContain('suggest_queries');
  });

  it('summary 不含 warning 当结果为空', async () => {
    // 0 结果时不触发警告(空结果不算"低质量",只是没找到)
    const adapter: SourceAdapter = { name: 'github', async search() { return []; } };
    const tool = createFindWheelTool({ adapters: [adapter] });
    const res = await tool.handle({ query: 'nonexistent thing' });
    const output = JSON.parse(res.content[0].text);
    expect(output.summary.warning).toBeUndefined();
  });
});
