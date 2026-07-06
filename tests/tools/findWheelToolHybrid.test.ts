// tests/tools/findWheelToolHybrid.test.ts
// Task 7: 验证 findWheelTool 的混合呈现(top3 内联 details + top4-10 hasDetails 标记 + top10 预抓取写缓存)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';

// mock enrichDetails: 用 vi.hoisted 拿到可在工厂里引用的引用
const { enrichDetailsMock } = vi.hoisted(() => ({
  enrichDetailsMock: vi.fn(),
}));

vi.mock('../../src/enrich/wheelDetailsEnricher.js', () => ({
  enrichDetails: enrichDetailsMock,
}));

import { createFindWheelTool } from '../../src/tools/findWheelTool.js';
import { createCache, type Cache } from '../../src/cache/cache.js';
import type { RawResult, Wheel } from '../../src/normalize/types.js';
import type { WheelDetails } from '../../src/enrich/wheelDetailsEnricher.js';
import { detailsCacheKey } from '../../src/tools/getWheelDetailsTool.js';
import { makeMockAdapter, makeTmpDir, makeGhResult } from './helpers.js';

// 构造 12 个 github 结果(makeGhResult 用默认 desc/stars/pushedAt)
function ghResults(count: number): RawResult[] {
  const names = ['a/b', 'c/d', 'e/f', 'g/h', 'i/j', 'k/l', 'm/n', 'o/p', 'q/r', 's/t', 'u/v', 'w/x'];
  return names.slice(0, count).map(name => makeGhResult(name));
}

// 构造一个简单的 WheelDetails(标记 name 用于区分)
function fakeDetails(name: string): WheelDetails {
  return {
    name, source: 'github', url: `https://github.com/${name}`,
    readmeSnippet: `readme of ${name}`,
    codeExamples: [],
  };
}

describe('findWheelTool 混合呈现 (Task 7)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    enrichDetailsMock.mockReset();
    // 默认禁用搜索缓存,避免磁盘污染
    process.env.FINDAWHEEL_CACHE_ENABLED = 'false';
  });

  it('enrichOpts 未配置时不预抓取,所有 wheels 无 details/hasDetails (向后兼容)', async () => {
    const tool = createFindWheelTool({
      adapters: [makeMockAdapter(ghResults(5))],
      // 不传 enrichOpts
    });
    const res = await tool.handle({ query: 'markdown editor' });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);
    expect(payload.wheels).toHaveLength(5);
    for (const w of payload.wheels) {
      expect(w.details).toBeUndefined();
      expect(w.hasDetails).toBeUndefined();
    }
    // enrichDetails 不应被调用
    expect(enrichDetailsMock).not.toHaveBeenCalled();
  });

  it('enrichOpts 配置时 top 3 内联 details, top 4-10 加 hasDetails', async () => {
    // 12 个结果: top3 内联, 4-10 hasDetails, 11-12 无标记
    const results = ghResults(12);
    // mock enrichDetails 对每个 wheel 返回对应 details
    enrichDetailsMock.mockImplementation(async (wheel: Wheel) => fakeDetails(wheel.name));

    const tool = createFindWheelTool({
      adapters: [makeMockAdapter(results)],
      enrichOpts: { timeoutMs: 5000 },
    });
    const res = await tool.handle({ query: 'markdown editor' });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);
    expect(payload.wheels).toHaveLength(12);

    // top 3 应有 details
    for (let i = 0; i < 3; i++) {
      expect(payload.wheels[i].details).toBeDefined();
      expect(payload.wheels[i].details.name).toBe(payload.wheels[i].name);
      expect(payload.wheels[i].hasDetails).toBeUndefined();
    }
    // top 4-10 应有 hasDetails=true, 无 details
    for (let i = 3; i < 10; i++) {
      expect(payload.wheels[i].hasDetails).toBe(true);
      expect(payload.wheels[i].details).toBeUndefined();
    }
    // top 11-12 无标记
    for (let i = 10; i < 12; i++) {
      expect(payload.wheels[i].details).toBeUndefined();
      expect(payload.wheels[i].hasDetails).toBeUndefined();
    }
    // enrichDetails 应被调用 10 次(top 10)
    expect(enrichDetailsMock).toHaveBeenCalledTimes(10);
  });

  it('结果不足 10 个时,全部尝试预抓取 (不超出实际数量)', async () => {
    const results = ghResults(5);
    enrichDetailsMock.mockImplementation(async (wheel: Wheel) => fakeDetails(wheel.name));

    const tool = createFindWheelTool({
      adapters: [makeMockAdapter(results)],
      enrichOpts: { timeoutMs: 5000 },
    });
    const res = await tool.handle({ query: 'markdown editor' });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.wheels).toHaveLength(5);
    // top 3 内联, top 4-5 hasDetails
    for (let i = 0; i < 3; i++) {
      expect(payload.wheels[i].details).toBeDefined();
    }
    for (let i = 3; i < 5; i++) {
      expect(payload.wheels[i].hasDetails).toBe(true);
    }
    expect(enrichDetailsMock).toHaveBeenCalledTimes(5);
  });

  it('detailsCache 提供时, top 10 成功抓取的 details 写入缓存', async () => {
    const dir = makeTmpDir('fw-hybrid');
    const detailsCache: Cache<WheelDetails> = createCache({ dir, ttlMs: 3600000, enabled: true });
    const results = ghResults(12);
    enrichDetailsMock.mockImplementation(async (wheel: Wheel) => fakeDetails(wheel.name));

    const tool = createFindWheelTool({
      adapters: [makeMockAdapter(results)],
      enrichOpts: { timeoutMs: 5000 },
      detailsCache,
    });
    await tool.handle({ query: 'markdown editor' });

    // 验证 top 10 的 details 都写入了缓存
    const top10Names = results.slice(0, 10).map(r => r.name);
    for (const name of top10Names) {
      const key = detailsCacheKey(name);
      const cached = await detailsCache.get(key);
      expect(cached).toBeDefined();
      expect(cached!.name).toBe(name);
    }
    // top 11-12 不应写入缓存
    const bottom2Names = results.slice(10).map(r => r.name);
    for (const name of bottom2Names) {
      const key = detailsCacheKey(name);
      const cached = await detailsCache.get(key);
      expect(cached).toBeUndefined();
    }
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('enrichDetails 返回 null (非 GitHub 源) 时该 wheel 不加标记', async () => {
    // 构造 npm 结果(非 github),会被 normalize 成 source='npm'
    const npmResults: RawResult[] = [
      { source: 'npm', name: 'pkg1', url: 'https://www.npmjs.com/package/pkg1',
        description: 'markdown editor', version: '1.0', keywords: [], date: '2025-06-01T00:00:00Z' },
      { source: 'npm', name: 'pkg2', url: 'https://www.npmjs.com/package/pkg2',
        description: 'markdown editor', version: '1.0', keywords: [], date: '2025-06-01T00:00:00Z' },
    ];
    // enrichDetails 对 npm 源返回 null
    enrichDetailsMock.mockResolvedValue(null);

    const tool = createFindWheelTool({
      adapters: [makeMockAdapter(npmResults)],
      enrichOpts: { timeoutMs: 5000 },
    });
    const res = await tool.handle({ query: 'markdown editor' });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.wheels).toHaveLength(2);
    for (const w of payload.wheels) {
      expect(w.details).toBeUndefined();
      expect(w.hasDetails).toBeUndefined();
    }
  });

  it('enrichDetails reject 时该 wheel 不加标记, 其他 wheel 正常 (容错)', async () => {
    const results = ghResults(5);
    // 第 2 个(index=1)reject,其他正常返回 details
    enrichDetailsMock.mockImplementation(async (wheel: Wheel) => {
      if (wheel.name === 'c/d') throw new Error('network down');
      return fakeDetails(wheel.name);
    });

    const tool = createFindWheelTool({
      adapters: [makeMockAdapter(results)],
      enrichOpts: { timeoutMs: 5000 },
    });
    const res = await tool.handle({ query: 'markdown editor' });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);
    expect(payload.wheels).toHaveLength(5);

    // index=1(c/d)失败:不加标记
    expect(payload.wheels[1].details).toBeUndefined();
    expect(payload.wheels[1].hasDetails).toBeUndefined();
    // index=0,2 正常内联 details(top3 范围内)
    expect(payload.wheels[0].details).toBeDefined();
    expect(payload.wheels[2].details).toBeDefined();
    // index=3,4 加 hasDetails(top4-10 范围)
    expect(payload.wheels[3].hasDetails).toBe(true);
    expect(payload.wheels[4].hasDetails).toBe(true);
  });

  it('缓存命中时返回带 details 的 wheels, 不重新抓取', async () => {
    const dir = makeTmpDir('fw-hybrid');
    const searchCache = createCache({ dir, ttlMs: 3600000, enabled: true });
    const results = ghResults(5);

    // 第一次调用:预抓取并写搜索缓存
    enrichDetailsMock.mockImplementation(async (wheel: Wheel) => fakeDetails(wheel.name));
    const tool = createFindWheelTool({
      adapters: [makeMockAdapter(results)],
      cache: searchCache,
      enrichOpts: { timeoutMs: 5000 },
    });
    const first = await tool.handle({ query: 'markdown editor' });
    const firstPayload = JSON.parse(first.content[0].text);
    expect(firstPayload.wheels[0].details).toBeDefined();
    expect(enrichDetailsMock).toHaveBeenCalledTimes(5);

    // 第二次调用:应命中搜索缓存,不调 enrichDetails
    enrichDetailsMock.mockClear();
    const second = await tool.handle({ query: 'markdown editor' });
    const secondPayload = JSON.parse(second.content[0].text);
    expect(secondPayload.cached).toBe(true);
    // 缓存的 wheels 应保留 details 字段
    expect(secondPayload.wheels[0].details).toBeDefined();
    expect(secondPayload.wheels[0].details.name).toBe(firstPayload.wheels[0].details.name);
    // 不应再次调 enrichDetails
    expect(enrichDetailsMock).not.toHaveBeenCalled();

    await fs.promises.rm(dir, { recursive: true, force: true });
  });
});
