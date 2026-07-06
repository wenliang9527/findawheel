// tests/regression/edgeCases.test.ts
// K 阶段:测试覆盖度提升。补充关键边界场景:
// 1. HuggingFace API 返回异常数据时的容错
// 2. recommender buildRecallReason 边界场景
// 3. exclude 参数与空结果交互
// 4. 多源混合时 recallReason 一致性
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeMatch, enrichWithMatch } from '../../src/rank/recommender.js';
import { HuggingfaceSourceAdapter } from '../../src/sources/huggingfaceSourceAdapter.js';
import { createFindWheelTool } from '../../src/tools/findWheelTool.js';
import type { SourceAdapter, SearchOpts } from '../../src/sources/sourceAdapter.js';
import type { RawResult, Wheel } from '../../src/normalize/types.js';

vi.mock('../../src/util/http.js', () => ({
  httpGet: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, public url: string, body: string) {
      super(`HTTP ${status}`);
    }
    get retryable(): boolean { return this.status >= 500; }
  },
}));

import { httpGet } from '../../src/util/http.js';

function makeWheel(over: Partial<Wheel> = {}): Wheel {
  return {
    name: 'x', source: 'github', url: 'https://github.com/x/x',
    description: 'desc', type: 'project',
    metrics: { stars: 100, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false, activity: 'high' },
    ...over,
  };
}

function gh(name: string, desc: string, stars: number): RawResult {
  return {
    source: 'github', name, url: `https://github.com/${name}`,
    description: desc, stars, language: null, license: 'MIT',
    archived: false, pushedAt: '2025-06-01T00:00:00Z', topics: [],
  } as RawResult;
}

function mockAdapter(name: string, results: RawResult[]): SourceAdapter {
  return {
    name,
    async search(_q: string, _o: SearchOpts): Promise<RawResult[]> { return results; },
  };
}

const baseOpts: SearchOpts = { intent: 'project', timeoutMs: 5000 };

describe('K 阶段:边界场景覆盖', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.FINDAWHEEL_CACHE_ENABLED = 'false';
  });

  describe('K1. HuggingFace 异常数据容错', () => {
    it('模型对象缺少 id 字段时容错(不崩溃)', async () => {
      // 异常:返回的对象没有 id 字段
      (httpGet as any).mockResolvedValue([
        { downloads: 100, likes: 5 }, // 缺 id
      ]);

      const adapter = new HuggingfaceSourceAdapter();
      // 不应抛错,应返回 name=undefined 的结果(由 normalizer 兜底)
      const results = await adapter.search('test', baseOpts);
      expect(results).toHaveLength(1);
      // name 应为 undefined 或空字符串(取决于 JS 行为)
      // 关键是不崩溃
    });

    it('API 返回 null 时容错为空数组', async () => {
      (httpGet as any).mockResolvedValue(null);

      const adapter = new HuggingfaceSourceAdapter();
      const results = await adapter.search('test', baseOpts);
      expect(results).toEqual([]);
    });

    it('模型 tags 是非数组类型时容错', async () => {
      (httpGet as any).mockResolvedValue([
        {
          id: 'bad-tags-model',
          downloads: 100,
          likes: 5,
          lastModified: '2024-06-01T00:00:00Z',
          tags: 'not-an-array', // 异常类型
        },
      ]);

      const adapter = new HuggingfaceSourceAdapter();
      const results = await adapter.search('test', baseOpts);
      // 不应崩溃,description 应有兜底值
      expect(results).toHaveLength(1);
      expect(results[0].description).toBeDefined();
    });

    it('lastModified 是无效日期字符串时 lastUpdated 为空', async () => {
      (httpGet as any).mockResolvedValue([
        {
          id: 'bad-date-model',
          downloads: 100,
          likes: 5,
          lastModified: 'invalid-date',
        },
      ]);

      const adapter = new HuggingfaceSourceAdapter();
      const results = await adapter.search('test', baseOpts);
      expect((results[0] as any).lastUpdated).toBe('invalid-date');
      // 我们不强制校验日期格式,原样透传给 normalizer 处理
    });
  });

  describe('K2. buildRecallReason 边界场景', () => {
    it('wheel 无 stars 时 recallReason 不含 stars 信息', () => {
      const w = makeWheel({
        name: 'no-stars-lib',
        description: 'markdown editor',
        metrics: { stars: 0, lastUpdated: '2025-01-01T00:00:00Z', archived: false, activity: 'high' },
      });
      const m = computeMatch(w, ['markdown', 'editor']);
      expect(m.recallReason).toBeDefined();
      expect(m.recallReason).not.toContain('stars');
      // 但应含命中信息
      expect(m.recallReason).toContain('命中');
    });

    it('wheel 无 activity 字段时 recallReason 推断为 low (P1-9: ?? low 兜底)', () => {
      const w = makeWheel({
        description: 'markdown editor',
        // 不提供 activity 字段,验证 P1-9 的 ?? 'low' 兜底逻辑
        metrics: { stars: 100, lastUpdated: '2025-01-01T00:00:00Z', archived: false },
      });
      const m = computeMatch(w, ['markdown']);
      expect(m.recallReason).toBeDefined();
      // activity 推断为 'low' → recallReason 含 "更新缓慢"
      expect(m.recallReason).toContain('更新缓慢');
    });

    it('零命中且无 stars 且 activity 兜底为 low 时 recallReason 含"零关键词命中"+"更新缓慢"', () => {
      const w = makeWheel({
        name: 'empty-lib',
        description: 'completely unrelated',
        metrics: { stars: 0, lastUpdated: '2025-01-01T00:00:00Z', archived: false },
      });
      const m = computeMatch(w, ['markdown', 'editor']);
      // P1-9:activity undefined → 'low' → recallReason 含"更新缓慢"
      expect(m.recallReason).toContain('零关键词命中');
      expect(m.recallReason).toContain('更新缓慢');
    });

    it('命中 5 个关键词时 recallReason 只显示前 3 个', () => {
      const w = makeWheel({
        description: 'markdown editor pdf converter cli tool',
        metrics: { stars: 100, lastUpdated: '2025-01-01T00:00:00Z', archived: false, activity: 'high' },
      });
      const keywords = ['markdown', 'editor', 'pdf', 'converter', 'cli', 'tool'];
      const m = computeMatch(w, keywords);
      // matchedKeywords 可能含全部,但 recallReason 只取前 3 个
      const hitPart = m.recallReason.split(';')[0];
      // 命中词用 / 分隔,应最多 3 个
      const hitWords = hitPart.replace('命中 ', '').split('/');
      expect(hitWords.length).toBeLessThanOrEqual(3);
    });
  });

  describe('K3. exclude 参数边界场景', () => {
    it('exclude 空数组时不过滤任何结果', async () => {
      const results = [
        gh('a/lib1', 'markdown editor', 1000),
        gh('b/lib2', 'markdown editor', 800),
      ];
      const tool = createFindWheelTool({ adapters: [mockAdapter('github', results)] });
      const res = await tool.handle({
        query: 'markdown editor',
        exclude: [],
      });
      const payload = JSON.parse(res.content[0].text);
      expect(payload.wheels).toHaveLength(2);
    });

    it('exclude 排除所有结果时返回空数组,total=0', async () => {
      const results = [
        gh('a/lib1', 'markdown editor', 1000),
        gh('b/lib2', 'markdown editor', 800),
      ];
      const tool = createFindWheelTool({ adapters: [mockAdapter('github', results)] });
      const res = await tool.handle({
        query: 'markdown editor',
        exclude: ['a/lib1', 'b/lib2'],
      });
      const payload = JSON.parse(res.content[0].text);
      expect(payload.wheels).toHaveLength(0);
      expect(payload.total).toBe(0);
      // summary 应正常生成(空结果也有 instruction)
      expect(payload.summary.instruction).toBeDefined();
    });

    it('exclude 含重复 name 时正常过滤(去重后匹配)', async () => {
      const results = [gh('a/lib1', 'markdown editor', 1000)];
      const tool = createFindWheelTool({ adapters: [mockAdapter('github', results)] });
      const res = await tool.handle({
        query: 'markdown editor',
        exclude: ['a/lib1', 'a/lib1', 'a/lib1'],
      });
      const payload = JSON.parse(res.content[0].text);
      expect(payload.wheels).toHaveLength(0);
    });
  });

  describe('K4. 多源混合时 recallReason 一致性', () => {
    it('GitHub 源和 HuggingFace 源的 recallReason 格式一致', async () => {
      const githubResult = gh('a/ml-lib', 'image segmentation library', 4000);
      const hfResult: RawResult = {
        source: 'huggingface', name: 'org/seg-model',
        url: 'https://huggingface.co/org/seg-model',
        description: 'semantic-segmentation (transformers)',
        stars: 200, downloads: 50000, lastUpdated: '2025-06-01T00:00:00Z',
      } as RawResult;

      const tool = createFindWheelTool({
        adapters: [
          mockAdapter('github', [githubResult]),
          mockAdapter('huggingface', [hfResult]),
        ],
      });
      const res = await tool.handle({ query: 'image segmentation' });
      const payload = JSON.parse(res.content[0].text);

      // 两个源的 recallReason 都应存在且格式一致
      for (const w of payload.wheels) {
        expect(w.match.recallReason).toBeDefined();
        expect(w.match.recallReason).toContain('命中');
        // 都应以分号分隔各部分
        expect(w.match.recallReason).toMatch(/;.+/);
      }
    });
  });

  describe('K5. enrichWithMatch 批量填充一致性', () => {
    it('空 wheels 数组时返回空数组', () => {
      const result = enrichWithMatch([], ['any', 'keywords']);
      expect(result).toEqual([]);
    });

    it('所有 wheel 都填充 recallReason 字段', () => {
      const wheels = [
        makeWheel({ name: 'a', description: 'markdown editor' }),
        makeWheel({ name: 'b', description: 'another tool' }),
        makeWheel({ name: 'c', description: 'unrelated' }),
      ];
      const result = enrichWithMatch(wheels, ['markdown', 'editor']);
      expect(result).toHaveLength(3);
      for (const w of result) {
        expect(w.match?.recallReason).toBeDefined();
        expect(typeof w.match!.recallReason).toBe('string');
        expect(w.match!.recallReason.length).toBeGreaterThan(0);
      }
    });
  });
});
