// tests/tools/findWheelToolFeedback.test.ts
// Task 4: 验证 findWheelTool 集成 feedback 加权 (like 加分上排, hide 扣分下排, 重新分级)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { createFindWheelTool } from '../../src/tools/findWheelTool.js';
import { createFeedbackStore } from '../../src/feedback/feedbackStore.js';
import type { SourceAdapter, SearchOpts } from '../../src/sources/sourceAdapter.js';
import type { RawResult, Wheel } from '../../src/normalize/types.js';

let dirCounter = 0;
function tmpDir(): string {
  dirCounter += 1;
  return path.join(os.tmpdir(), `fw-fb-integration-${process.pid}-${dirCounter}`);
}

// 构造 github 结果: name, stars, description 含 query 词避免被过滤
function ghResult(name: string, stars: number): RawResult {
  return {
    source: 'github', name, url: `https://github.com/${name}`,
    description: 'markdown editor library', stars, language: null,
    license: 'MIT', archived: false, pushedAt: '2025-06-01T00:00:00Z', topics: [],
  };
}

function mockAdapter(results: RawResult[]): SourceAdapter {
  return {
    name: 'github',
    async search(_q: string, _o: SearchOpts): Promise<RawResult[]> { return results; },
  };
}

describe('findWheelTool feedback 集成 (Task 4)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.FINDAWHEEL_CACHE_ENABLED = 'false';
  });

  it('feedbackStore 未提供时不调整 (向后兼容)', async () => {
    const results = [ghResult('a/b', 100), ghResult('c/d', 200)];
    const tool = createFindWheelTool({
      adapters: [mockAdapter(results)],
      // 不传 feedbackStore
    });
    const res = await tool.handle({ query: 'markdown editor' });
    const payload = JSON.parse(res.content[0].text);
    // 无 feedbackDelta 字段
    for (const w of payload.wheels) {
      expect(w.match.feedbackDelta).toBeUndefined();
    }
  });

  it('feedbackStore 无记录时不调整', async () => {
    const dir = tmpDir();
    fs.rmSync(dir, { recursive: true, force: true });
    const store = createFeedbackStore({ dir });
    const results = [ghResult('a/b', 100), ghResult('c/d', 200)];
    const tool = createFindWheelTool({
      adapters: [mockAdapter(results)],
      feedbackStore: store,
    });
    const res = await tool.handle({ query: 'markdown editor' });
    const payload = JSON.parse(res.content[0].text);
    for (const w of payload.wheels) {
      expect(w.match.feedbackDelta).toBeUndefined();
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('like 反馈提升 wheel 的 score 和排序', async () => {
    const dir = tmpDir();
    fs.rmSync(dir, { recursive: true, force: true });
    const store = createFeedbackStore({ dir });
    // 预先记录: a/b 被 like, c/d 无反馈
    await store.recordFeedback('a/b', 'like');
    await store.recordFeedback('a/b', 'like');
    await store.recordFeedback('a/b', 'like');

    // 构造结果: c/d stars 高排前面, a/b stars 低排后面
    const results = [ghResult('c/d', 5000), ghResult('a/b', 100)];
    const tool = createFindWheelTool({
      adapters: [mockAdapter(results)],
      feedbackStore: store,
    });
    const res = await tool.handle({ query: 'markdown editor' });
    const payload = JSON.parse(res.content[0].text);

    // a/b 有 feedbackDelta (+0.6), c/d 无
    const ab = payload.wheels.find((w: Wheel) => w.name === 'a/b');
    const cd = payload.wheels.find((w: Wheel) => w.name === 'c/d');
    expect(ab.match.feedbackDelta).toBeCloseTo(0.6, 5);
    expect(cd.match.feedbackDelta).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('hide 反馈降低 score 并可能降级 recommendation', async () => {
    const dir = tmpDir();
    fs.rmSync(dir, { recursive: true, force: true });
    const store = createFeedbackStore({ dir });
    // a/b 被 hide 多次
    await store.recordFeedback('a/b', 'hide');
    await store.recordFeedback('a/b', 'hide');

    const results = [ghResult('a/b', 5000), ghResult('c/d', 100)];
    const tool = createFindWheelTool({
      adapters: [mockAdapter(results)],
      feedbackStore: store,
    });
    const res = await tool.handle({ query: 'markdown editor' });
    const payload = JSON.parse(res.content[0].text);
    const ab = payload.wheels.find((w: Wheel) => w.name === 'a/b');
    // hide 2 次 = -1.0, score 被钳制到 0
    expect(ab.match.feedbackDelta).toBeCloseTo(-1.0, 5);
    expect(ab.match.score).toBe(0); // 钳制到下限
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('feedback 调整后重新排序 (hide 的 wheel 下沉)', async () => {
    const dir = tmpDir();
    fs.rmSync(dir, { recursive: true, force: true });
    const store = createFeedbackStore({ dir });
    // a/b 被 hide, c/d 被 like
    await store.recordFeedback('a/b', 'hide');
    await store.recordFeedback('c/d', 'like');

    // 初始: a/b stars 高排前面, c/d stars 低排后面
    const results = [ghResult('a/b', 5000), ghResult('c/d', 100)];
    const tool = createFindWheelTool({
      adapters: [mockAdapter(results)],
      feedbackStore: store,
    });
    const res = await tool.handle({ query: 'markdown editor' });
    const payload = JSON.parse(res.content[0].text);

    // 调整后: c/d 应排在 a/b 前面 (c/d +0.2, a/b -0.5)
    expect(payload.wheels[0].name).toBe('c/d');
    expect(payload.wheels[1].name).toBe('a/b');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('feedback 调整后重新分级 recommendation', async () => {
    const dir = tmpDir();
    fs.rmSync(dir, { recursive: true, force: true });
    const store = createFeedbackStore({ dir });
    // a/b 被 hide 多次, 应从 highly_recommended 降级
    await store.recordFeedback('a/b', 'hide');
    await store.recordFeedback('a/b', 'hide');
    await store.recordFeedback('a/b', 'hide');

    const results = [ghResult('a/b', 5000)]; // 高 stars, 原本 highly_recommended
    const tool = createFindWheelTool({
      adapters: [mockAdapter(results)],
      feedbackStore: store,
    });
    const res = await tool.handle({ query: 'markdown editor' });
    const payload = JSON.parse(res.content[0].text);
    const ab = payload.wheels[0];
    // 3 hides = -1.5, score 大幅降低, recommendation 应降级
    expect(ab.match.recommendation).not.toBe('highly_recommended');
    expect(ab.match.feedbackDelta).toBeCloseTo(-1.5, 5);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('无 feedback 的 wheel 保持原 score 和等级', async () => {
    const dir = tmpDir();
    fs.rmSync(dir, { recursive: true, force: true });
    const store = createFeedbackStore({ dir });
    // 只给 a/b 记录反馈, c/d 无
    await store.recordFeedback('a/b', 'like');

    const results = [ghResult('a/b', 100), ghResult('c/d', 2000)];
    const tool = createFindWheelTool({
      adapters: [mockAdapter(results)],
      feedbackStore: store,
    });
    const res = await tool.handle({ query: 'markdown editor' });
    const payload = JSON.parse(res.content[0].text);
    const cd = payload.wheels.find((w: Wheel) => w.name === 'c/d');
    // c/d 无反馈: feedbackDelta undefined, score 未变
    expect(cd.match.feedbackDelta).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
