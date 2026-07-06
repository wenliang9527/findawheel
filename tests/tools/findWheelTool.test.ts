// tests/tools/findWheelTool.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFindWheelTool } from '../../src/tools/findWheelTool.js';
import { createCache } from '../../src/cache/cache.js';
import type { SourceAdapter } from '../../src/sources/sourceAdapter.js';
import type { RawResult } from '../../src/normalize/types.js';
import * as fs from 'node:fs';
import {
  makeMockAdapter, makeFailingAdapter, makeTmpDir, makeGhResult,
} from './helpers.js';

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
      adapters: [makeMockAdapter([gh], 'github'), makeMockAdapter([npm], 'registry')],
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
      adapters: [makeMockAdapter([gh], 'github'), makeFailingAdapter('registry')],
    });
    const res = await tool.handle({ query: 'x' });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);
    expect(payload.wheels).toHaveLength(1);
    expect(payload.degradedSources).toEqual(['registry']);
  });

  it('returns isError when all adapters fail', async () => {
    const tool = createFindWheelTool({
      adapters: [makeFailingAdapter('github'), makeFailingAdapter('registry')],
    });
    const res = await tool.handle({ query: 'x' });
    expect(res.isError).toBe(true);
  });

  it('returns empty wheels when all sources return 0', async () => {
    const tool = createFindWheelTool({
      adapters: [makeMockAdapter([], 'github')],
    });
    const res = await tool.handle({ query: 'x' });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);
    expect(payload.wheels).toEqual([]);
  });

  // ===== 缓存集成测试 =====

  it('缓存命中时不调用 adapter', async () => {
    const dir = makeTmpDir();
    const cache = createCache({ dir, ttlMs: 3600000, enabled: true });
    const gh = makeGhResult('a/b', { desc: 'A markdown editor' });
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
    const dir = makeTmpDir();
    const cache = createCache({ dir, ttlMs: 3600000, enabled: true });
    const gh = makeGhResult('a/b', { desc: 'A markdown editor' });
    const adapter = makeMockAdapter([gh], 'github');
    const tool = createFindWheelTool({ adapters: [adapter], cache });
    await tool.handle({ query: 'markdown editor' });
    // 缓存文件应该存在
    const files = await fs.promises.readdir(dir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/\.json$/);
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('disabled 时不缓存,每次都调 adapter', async () => {
    const dir = makeTmpDir();
    const cache = createCache({ dir, ttlMs: 3600000, enabled: false });
    const gh = makeGhResult('a/b', { desc: 'A markdown editor' });
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
    const dir = makeTmpDir();
    const cache = createCache({ dir, ttlMs: 3600000, enabled: true });
    const gh = makeGhResult('a/b', { desc: 'A markdown editor' });
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
    // O1:github 在 RATE_LIMITED_SOURCES 中,副搜索跳过它,
    // 所以 dedupe 后只有 1 次主搜索调用(无副搜索)。
    // 若无 dedupe 会跑两次(2 次主搜索)。
    expect(searchSpy.mock.calls.length).toBe(1);
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  // ===== Phase 5 新增:低质量结果警告 =====

  it('summary 不含 warning 当 top 1 stars >= 10', async () => {
    // stars=100 的结果不应触发警告
    const gh = makeGhResult('a/popular-lib', { desc: 'A markdown editor' });
    const adapter: SourceAdapter = { name: 'github', async search() { return [gh]; } };
    const tool = createFindWheelTool({ adapters: [adapter] });
    const res = await tool.handle({ query: 'markdown editor' });
    const output = JSON.parse(res.content[0].text);
    expect(output.summary.warning).toBeUndefined();
  });

  it('summary 含 warning 当 top 1 stars < 10', async () => {
    // stars=3 的结果应触发低质量警告(模拟小众领域召回差的情况)
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

  // ===== T2: degraded 场景测试 =====
  // H3 修复:主搜索失败时无条件标记 degraded,无论副搜索是否成功

  it('T2: marks source degraded when it fails (other sources succeed)', async () => {
    const good = makeMockAdapter([makeGhResult('a/b', { desc: 'markdown editor' })], 'github');
    const bad = makeFailingAdapter('gitee');
    const tool = createFindWheelTool({ adapters: [good, bad] });
    const res = await tool.handle({ query: 'markdown editor' });
    expect(res.isError).toBeFalsy();
    const output = JSON.parse(res.content[0].text);
    expect(output.degradedSources).toContain('gitee');
    expect(output.wheels.length).toBeGreaterThan(0);
  });

  it('T2: returns isError when all sources fail', async () => {
    const bad1 = makeFailingAdapter('github');
    const bad2 = makeFailingAdapter('gitee');
    const tool = createFindWheelTool({ adapters: [bad1, bad2] });
    const res = await tool.handle({ query: 'markdown editor' });
    expect(res.isError).toBe(true);
  });

  it('T2: no degradedSources when all sources succeed', async () => {
    const good1 = makeMockAdapter([makeGhResult('a/b', { desc: 'markdown editor' })], 'github');
    const good2 = makeMockAdapter([{
      source: 'npm', name: 'pkg', url: 'https://www.npmjs.com/package/pkg',
      description: 'markdown editor lib', version: '1.0', keywords: [], date: '2025-06-01T00:00:00Z',
    }], 'registry');
    const tool = createFindWheelTool({ adapters: [good1, good2] });
    const res = await tool.handle({ query: 'markdown editor' });
    const output = JSON.parse(res.content[0].text);
    expect(output.degradedSources).toBeUndefined();
  });

  // ===== R1: 智能路由测试 =====
  // 硬件类 query 只搜 GitHub/Gitee/PapersWithCode,跳过 npm/PyPI/HuggingFace

  it('R1: hardware query returns skippedSources field', async () => {
    // stepper motor 是硬件类 query,应跳过 npm/PyPI 等
    // 给 5 个 stars=100 的结果,避免触发 < 5 兜底扩展(扩展后不报告 skippedSources)
    const ghResults: RawResult[] = Array.from({ length: 5 }, (_, i) => ({
      source: 'github', name: `a/stepper-lib-${i}`, url: `https://github.com/a/stepper-lib-${i}`,
      description: 'stepper motor control library', stars: 100, language: null, license: 'MIT',
      archived: false, pushedAt: '2025-06-01T00:00:00Z', topics: [],
    }));
    const good = makeMockAdapter(ghResults, 'github');
    const npmAdapter = makeMockAdapter([], 'registry');
    const pypiAdapter = makeMockAdapter([], 'pypi');
    const tool = createFindWheelTool({ adapters: [good, npmAdapter, pypiAdapter] });
    const res = await tool.handle({ query: 'stepper motor control' });
    expect(res.isError).toBeFalsy();
    const output = JSON.parse(res.content[0].text);
    expect(output.skippedSources).toBeDefined();
    expect(output.skippedSources).toContain('registry');
    expect(output.skippedSources).toContain('pypi');
    expect(output.routingReason).toContain('硬件');
  });

  it('R1: generic query does not return skippedSources (fallback all)', async () => {
    // markdown editor 不匹配任何路由规则,走兜底全搜
    const good = makeMockAdapter([makeGhResult('a/b', { desc: 'markdown editor' })], 'github');
    const tool = createFindWheelTool({ adapters: [good] });
    const res = await tool.handle({ query: 'markdown editor' });
    const output = JSON.parse(res.content[0].text);
    expect(output.skippedSources).toBeUndefined();
    expect(output.routingReason).toBeUndefined();
  });

  it('R1: ecosystem=python routes to PyPI/GitHub only', async () => {
    // ecosystem=python 时路由跳过 npm。用 github 返回 5 个 stars=100 的结果,
    // 避免触发 < 5 兜底扩展(扩展后不报告 skippedSources)
    // 注:pypi RawResult 无 stars 字段,无法满足 stars>=10,故用 github 验证路由跳过 npm 的行为
    const ghResults: RawResult[] = Array.from({ length: 5 }, (_, i) => ({
      source: 'github', name: `a/py-lib-${i}`, url: `https://github.com/a/py-lib-${i}`,
      description: 'python web framework', stars: 100, language: 'Python', license: 'MIT',
      archived: false, pushedAt: '2025-06-01T00:00:00Z', topics: [],
    }));
    const ghAdapter = makeMockAdapter(ghResults, 'github');
    const npmAdapter = makeMockAdapter([], 'registry');
    const tool = createFindWheelTool({ adapters: [ghAdapter, npmAdapter] });
    const res = await tool.handle({ query: 'python web framework', ecosystem: 'python' });
    const output = JSON.parse(res.content[0].text);
    expect(output.skippedSources).toContain('registry');
    expect(output.routingReason).toContain('python');
  });

  // ===== R2: 兜底扩展测试 =====
  // 召回不足(top 1 stars < 10 或结果 < 5 条)时扩展到全源重搜

  it('R2: triggers fallback expansion when top result stars < 10', async () => {
    // 主搜(github)只返回低 star 结果,应触发扩展搜索被跳过的源
    const lowStarGh: RawResult = {
      source: 'github', name: 'a/tiny', url: 'https://github.com/a/tiny',
      description: 'stepper motor lib', stars: 3, language: null, license: 'MIT',
      archived: false, pushedAt: '2025-06-01T00:00:00Z', topics: [],
    };
    const ghAdapter = makeMockAdapter([lowStarGh], 'github');
    // 被跳过的 npm 应在扩展阶段被搜索
    const npmAdapter = makeMockAdapter([{
      source: 'npm', name: 'stepper-pkg', url: 'https://www.npmjs.com/package/stepper-pkg',
      description: 'stepper motor lib', version: '1.0', keywords: [], date: '2025-06-01T00:00:00Z',
    }], 'registry');
    const tool = createFindWheelTool({ adapters: [ghAdapter, npmAdapter] });
    const res = await tool.handle({ query: 'stepper motor control' });
    const output = JSON.parse(res.content[0].text);
    // 触发扩展后不再返回 skippedSources(全部源都搜过了)
    expect(output.skippedSources).toBeUndefined();
    // 结果应包含扩展阶段找到的 npm 包
    expect(output.wheels.some((w: any) => w.name === 'stepper-pkg')).toBe(true);
  });

  it('R2: does not trigger expansion when top result stars >= 10', async () => {
    // 主搜返回高质量结果(5 个 stars=100),不触发扩展(< 5 和 < 10 都不满足)
    const ghResults: RawResult[] = Array.from({ length: 5 }, (_, i) => ({
      source: 'github', name: `a/popular-${i}`, url: `https://github.com/a/popular-${i}`,
      description: 'stepper motor library', stars: 100, language: null, license: 'MIT',
      archived: false, pushedAt: '2025-06-01T00:00:00Z', topics: [],
    }));
    const ghAdapter = makeMockAdapter(ghResults, 'github');
    const npmAdapter = makeMockAdapter([{
      source: 'npm', name: 'should-not-appear', url: 'https://www.npmjs.com/package/x',
      description: 'should not be searched', version: '1.0', keywords: [], date: '2025-06-01T00:00:00Z',
    }], 'registry');
    const tool = createFindWheelTool({ adapters: [ghAdapter, npmAdapter] });
    const res = await tool.handle({ query: 'stepper motor control' });
    const output = JSON.parse(res.content[0].text);
    // 不触发扩展,应返回 skippedSources
    expect(output.skippedSources).toContain('registry');
    // npm 的结果不应出现(没被搜)
    expect(output.wheels.some((w: any) => w.name === 'should-not-appear')).toBe(false);
  });

  it('R2: triggers fallback expansion when results count < 5', async () => {
    // 主搜只返回 1 条结果(< 5),应触发扩展
    const ghAdapter = makeMockAdapter([makeGhResult('a/lib', { desc: 'stepper motor lib' })], 'github');
    const giteeAdapter = makeMockAdapter([{
      source: 'gitee', name: 'b/lib2', url: 'https://gitee.com/b/lib2',
      description: 'stepper motor driver', stars: 50, language: 'C++', license: 'MIT',
      archived: false, pushedAt: '2025-06-01T00:00:00Z', topics: [],
    }], 'gitee');
    const npmAdapter = makeMockAdapter([], 'registry');
    const tool = createFindWheelTool({ adapters: [ghAdapter, giteeAdapter, npmAdapter] });
    const res = await tool.handle({ query: 'stepper motor control' });
    const output = JSON.parse(res.content[0].text);
    // 触发扩展后 skippedSources 应为 undefined
    expect(output.skippedSources).toBeUndefined();
  });

  // Phase 6 简化:删除领域泛词过滤测试和 coreWords 过滤测试。
  // 这些过滤机制已删除 —— 相关性判断交给 AI 调用方。
  // 主流库 Neutree/COMTool 等不再被硬规则误杀,会正常出现在结果中。
});
