// tests/regression/phase6Simplification.test.ts
// Phase 6 简化回归测试:验证"删硬过滤 + 保留软排序"的核心行为符合预期。
// 这些测试用 mock 数据固化"金标准 query 应召回主流库"的期望,
// 防止未来改动破坏简化成果(如重新引入过拟合的硬过滤)。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFindWheelTool } from '../../src/tools/findWheelTool.js';
import type { SourceAdapter } from '../../src/sources/sourceAdapter.js';
import type { RawResult } from '../../src/normalize/types.js';
import { makeMockAdapter } from '../tools/helpers.js';

// 构造 GitHub RawResult
function gh(
  name: string,
  desc: string,
  stars: number,
  over: Partial<RawResult> = {},
): RawResult {
  return {
    source: 'github',
    name,
    url: `https://github.com/${name}`,
    description: desc,
    stars,
    language: null,
    license: 'MIT',
    archived: false,
    pushedAt: '2025-06-01T00:00:00Z',
    topics: [],
    ...over,
  } as RawResult;
}

function mockAdapter(results: RawResult[]): SourceAdapter {
  return makeMockAdapter(results, 'github');
}

describe('Phase 6 简化回归测试', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.FINDAWHEEL_CACHE_ENABLED = 'false';
  });

  afterEach(() => {
    delete process.env.FINDAWHEEL_CACHE_ENABLED;
  });

  describe('A1. 主流库不被误杀', () => {
    it('stepper motor 搜索:AccelStepper(description 含 stepper)排前面', async () => {
      // 场景:嵌入式领域,主流库 description 含 query 词,应排前面
      const results = [
        // 高 stars 但零命中(voicebox 类似场景)
        gh('ai/voice-studio', 'Open-source AI voice studio', 37000),
        // 主流库:3k stars,description 含 stepper motor
        gh('adafruit/AccelStepper', 'Arduino stepper motor library for acceleration control', 3000),
      ];
      const tool = createFindWheelTool({ adapters: [mockAdapter(results)] });
      const res = await tool.handle({ query: 'stepper motor driver' });
      const payload = JSON.parse(res.content[0].text);
      // AccelStepper 应排第 1(命中 stepper/motor/driver,虽然 stars 低)
      // voice-studio 零命中应被降权
      expect(payload.wheels[0].name).toBe('adafruit/AccelStepper');
      expect(payload.wheels[1].name).toBe('ai/voice-studio');
    });

    it('markdown editor 搜索:主流编辑器排前面,归档项目被过滤', async () => {
      const results = [
        // 主流编辑器
        gh('milkdown/milkdown', 'markdown editor with plugin-driven architecture', 8000),
        // 归档项目(应被过滤)
        gh('old/archived-editor', 'legacy markdown editor', 500, { archived: true }),
      ];
      const tool = createFindWheelTool({ adapters: [mockAdapter(results)] });
      const res = await tool.handle({ query: 'markdown editor' });
      const payload = JSON.parse(res.content[0].text);
      expect(payload.wheels).toHaveLength(1);
      expect(payload.wheels[0].name).toBe('milkdown/milkdown');
    });

    it('Neutree/COMTool 类主流库不被 coreWords 过滤误杀', async () => {
      // 场景:Phase 5 P9 修复的 bug —— coreWords 过滤误杀主流库
      // Phase 6 彻底删除 coreWords 过滤,这些库应正常出现
      const results = [
        // COMTool:description 不一定含 query 原词,但是主流串口工具
        gh('Neutree/COMTool', 'Cross-platform serial port debug tool', 1200),
      ];
      const tool = createFindWheelTool({ adapters: [mockAdapter(results)] });
      const res = await tool.handle({ query: 'serial debug assistant' });
      const payload = JSON.parse(res.content[0].text);
      expect(payload.wheels).toHaveLength(1);
      expect(payload.wheels[0].name).toBe('Neutree/COMTool');
    });
  });

  describe('A2. 高 star 零命中降权', () => {
    it('voicebox(37k stars, 零命中)不霸榜,排在小众命中项目之后', async () => {
      const results = [
        // 超高 stars 但零命中
        gh('voicebox/ai-studio', 'The open-source AI voice studio', 37000),
        // 低 stars 但命中 query
        gh('small/coding-monitor', 'Monitor AI coding assistant status in real time', 200),
      ];
      const tool = createFindWheelTool({ adapters: [mockAdapter(results)] });
      const res = await tool.handle({ query: 'AI coding monitor' });
      const payload = JSON.parse(res.content[0].text);
      // coding-monitor 应排第 1(命中 AI/coding/monitor)
      // voicebox 零命中,stars 权重 ×0.3,应排第 2
      expect(payload.wheels[0].name).toBe('small/coding-monitor');
      expect(payload.wheels[1].name).toBe('voicebox/ai-studio');
    });
  });

  describe('A3. 反向意图不被硬过滤(Phase 6 简化)', () => {
    it('remove watermark 搜索:watermark-remover 不被过滤,正常出现', async () => {
      // Phase 6 删除了 isReverseIntent 硬过滤
      // 反向意图项目应正常出现,由 AI 调用方自行识别
      const results = [
        // 反向意图项目( remover)
        gh('tools/watermark-remover', 'Remove watermark from images automatically', 2000),
        // 正向项目(add watermark)
        gh('lib/image-watermark', 'Add watermark to images', 1000),
      ];
      const tool = createFindWheelTool({ adapters: [mockAdapter(results)] });
      const res = await tool.handle({ query: 'watermark' });
      const payload = JSON.parse(res.content[0].text);
      // 两个都应出现(不被过滤)
      expect(payload.wheels).toHaveLength(2);
      // AI 调用方负责识别反向意图,findawheel 不做硬过滤
    });
  });

  describe('A4. 聚合仓库仍被过滤', () => {
    it('awesome-xxx 仓库被过滤,不参与排序', async () => {
      const results = [
        // 聚合仓库(应被过滤)
        gh('awesome/awesome-stepper', 'A curated list of stepper motor resources', 5000),
        // 正常项目
        gh('adafruit/AccelStepper', 'Arduino stepper motor library', 3000),
      ];
      const tool = createFindWheelTool({ adapters: [mockAdapter(results)] });
      const res = await tool.handle({ query: 'stepper motor' });
      const payload = JSON.parse(res.content[0].text);
      // awesome-stepper 应被过滤,只剩 AccelStepper
      expect(payload.wheels).toHaveLength(1);
      expect(payload.wheels[0].name).toBe('adafruit/AccelStepper');
    });

    it('public-apis 聚合仓库被过滤', async () => {
      const results = [
        gh('public-apis/public-apis', 'A collective list of free APIs for developers', 300000),
      ];
      const tool = createFindWheelTool({ adapters: [mockAdapter(results)] });
      const res = await tool.handle({ query: 'weather api' });
      const payload = JSON.parse(res.content[0].text);
      expect(payload.wheels).toHaveLength(0);
    });
  });

  describe('A5. 中文 query 翻译后能匹配英文项目', () => {
    it('串口调试 翻译为 serial debug,能匹配英文 description', async () => {
      const results = [
        gh('serial/terminal', 'Serial port debug terminal tool', 500),
      ];
      const tool = createFindWheelTool({ adapters: [mockAdapter(results)] });
      const res = await tool.handle({ query: '串口调试' });
      const payload = JSON.parse(res.content[0].text);
      expect(payload.wheels).toHaveLength(1);
      expect(payload.wheels[0].name).toBe('serial/terminal');
    });

    it('步进电机 翻译为 stepper motor,能匹配英文项目', async () => {
      const results = [
        gh('adafruit/AccelStepper', 'Stepper motor library with acceleration', 3000),
      ];
      const tool = createFindWheelTool({ adapters: [mockAdapter(results)] });
      const res = await tool.handle({ query: '步进电机驱动' });
      const payload = JSON.parse(res.content[0].text);
      expect(payload.wheels).toHaveLength(1);
      expect(payload.wheels[0].name).toBe('adafruit/AccelStepper');
    });
  });

  describe('A6. summary 引导 AI 列全结果', () => {
    it('summary 含 instruction 提示 AI 推荐 2-3 个而非只挑 1 个', async () => {
      const results = [
        gh('a/lib1', 'markdown editor', 1000),
        gh('b/lib2', 'markdown editor', 800),
        gh('c/lib3', 'markdown editor', 500),
      ];
      const tool = createFindWheelTool({ adapters: [mockAdapter(results)] });
      const res = await tool.handle({ query: 'markdown editor' });
      const payload = JSON.parse(res.content[0].text);
      expect(payload.summary.instruction).toBeDefined();
      expect(payload.summary.instruction).toContain('2-3');
      expect(payload.summary.instruction).toContain('选择权');
    });

    it('低质量结果(top 1 stars < 10)触发警告', async () => {
      const results = [
        gh('tiny/project', 'markdown editor', 3),
      ];
      const tool = createFindWheelTool({ adapters: [mockAdapter(results)] });
      const res = await tool.handle({ query: 'markdown editor' });
      const payload = JSON.parse(res.content[0].text);
      expect(payload.summary.warning).toBeDefined();
      expect(payload.summary.warning).toContain('3 stars');
    });
  });
});
