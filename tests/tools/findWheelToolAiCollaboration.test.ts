// tests/tools/findWheelToolAiCollaboration.test.ts
// C 阶段:验证 AI 协作深化(exclude 参数 + recallReason 召回解释)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFindWheelTool } from '../../src/tools/findWheelTool.js';
import { makeMockAdapter, makeGhResult } from './helpers.js';

describe('findWheelTool AI 协作深化 (C 阶段)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.FINDAWHEEL_CACHE_ENABLED = 'false';
  });

  describe('exclude 参数', () => {
    it('exclude 指定的 wheel 不出现在结果中', async () => {
      const results = [
        makeGhResult('a/lib1', { desc: 'markdown editor', stars: 1000 }),
        makeGhResult('b/lib2', { desc: 'markdown editor', stars: 800 }),
        makeGhResult('c/lib3', { desc: 'markdown editor', stars: 500 }),
      ];
      const tool = createFindWheelTool({ adapters: [makeMockAdapter(results)] });

      // 第一次:全部返回
      const res1 = await tool.handle({ query: 'markdown editor' });
      const payload1 = JSON.parse(res1.content[0].text);
      expect(payload1.wheels).toHaveLength(3);

      // 第二次:exclude b/lib2
      const res2 = await tool.handle({
        query: 'markdown editor',
        exclude: ['b/lib2'],
      });
      const payload2 = JSON.parse(res2.content[0].text);
      expect(payload2.wheels).toHaveLength(2);
      expect(payload2.wheels.map((w: { name: string }) => w.name)).not.toContain('b/lib2');
    });

    it('exclude 大小写不敏感', async () => {
      const results = [
        makeGhResult('A/Lib1', { desc: 'markdown editor', stars: 1000 }),
        makeGhResult('b/lib2', { desc: 'markdown editor', stars: 800 }),
      ];
      const tool = createFindWheelTool({ adapters: [makeMockAdapter(results)] });
      const res = await tool.handle({
        query: 'markdown editor',
        exclude: ['a/lib1'], // 小写
      });
      const payload = JSON.parse(res.content[0].text);
      expect(payload.wheels).toHaveLength(1);
      expect(payload.wheels[0].name).toBe('b/lib2');
    });

    it('exclude 不存在的 name 时,结果不变', async () => {
      const results = [makeGhResult('a/lib1', { desc: 'markdown editor', stars: 1000 })];
      const tool = createFindWheelTool({ adapters: [makeMockAdapter(results)] });
      const res = await tool.handle({
        query: 'markdown editor',
        exclude: ['nonexistent/repo'],
      });
      const payload = JSON.parse(res.content[0].text);
      expect(payload.wheels).toHaveLength(1);
    });

    it('exclude 多个 wheel 同时过滤', async () => {
      const results = [
        makeGhResult('a/lib1', { desc: 'markdown editor', stars: 1000 }),
        makeGhResult('b/lib2', { desc: 'markdown editor', stars: 800 }),
        makeGhResult('c/lib3', { desc: 'markdown editor', stars: 500 }),
        makeGhResult('d/lib4', { desc: 'markdown editor', stars: 300 }),
      ];
      const tool = createFindWheelTool({ adapters: [makeMockAdapter(results)] });
      const res = await tool.handle({
        query: 'markdown editor',
        exclude: ['a/lib1', 'c/lib3'],
      });
      const payload = JSON.parse(res.content[0].text);
      expect(payload.wheels).toHaveLength(2);
      expect(payload.wheels.map((w: { name: string }) => w.name)).toEqual(['b/lib2', 'd/lib4']);
    });
  });

  describe('recallReason 召回解释', () => {
    it('每个 wheel 的 match 字段含 recallReason', async () => {
      const results = [makeGhResult('a/lib', { desc: 'markdown editor library', stars: 1000 })];
      const tool = createFindWheelTool({ adapters: [makeMockAdapter(results)] });
      const res = await tool.handle({ query: 'markdown editor' });
      const payload = JSON.parse(res.content[0].text);
      expect(payload.wheels[0].match.recallReason).toBeDefined();
      expect(typeof payload.wheels[0].match.recallReason).toBe('string');
    });

    it('recallReason 含命中关键词信息', async () => {
      const results = [makeGhResult('a/stepper-lib', { desc: 'stepper motor driver library', stars: 3000 })];
      const tool = createFindWheelTool({ adapters: [makeMockAdapter(results)] });
      const res = await tool.handle({ query: 'stepper motor' });
      const payload = JSON.parse(res.content[0].text);
      const recall = payload.wheels[0].match.recallReason;
      expect(recall).toContain('命中');
      expect(recall).toMatch(/stepper|motor/);
    });

    it('recallReason 含 stars 信息', async () => {
      const results = [makeGhResult('a/popular-lib', { desc: 'markdown editor', stars: 12000 })];
      const tool = createFindWheelTool({ adapters: [makeMockAdapter(results)] });
      const res = await tool.handle({ query: 'markdown editor' });
      const payload = JSON.parse(res.content[0].text);
      const recall = payload.wheels[0].match.recallReason;
      expect(recall).toContain('12.0k stars');
    });

    it('零命中时 recallReason 提示可能不相关', async () => {
      const results = [makeGhResult('a/unrelated', { desc: 'completely unrelated project', stars: 50000 })];
      const tool = createFindWheelTool({ adapters: [makeMockAdapter(results)] });
      const res = await tool.handle({ query: 'markdown editor' });
      const payload = JSON.parse(res.content[0].text);
      const recall = payload.wheels[0].match.recallReason;
      expect(recall).toContain('零关键词命中');
      expect(recall).toContain('可能不相关');
    });

    it('recallReason 含活跃度信息', async () => {
      const results = [makeGhResult('a/active-lib', { desc: 'markdown editor actively maintained', stars: 2000 })];
      const tool = createFindWheelTool({ adapters: [makeMockAdapter(results)] });
      const res = await tool.handle({ query: 'markdown editor' });
      const payload = JSON.parse(res.content[0].text);
      const recall = payload.wheels[0].match.recallReason;
      // pushedAt 是 2025-06-01,距今不到 1 年,应为活跃维护
      expect(recall).toMatch(/活跃维护|近期有更新/);
    });
  });
});
