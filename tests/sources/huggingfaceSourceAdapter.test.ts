// tests/sources/huggingfaceSourceAdapter.test.ts
// HuggingFace Hub 适配器测试(D 阶段新增数据源)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HuggingfaceSourceAdapter } from '../../src/sources/huggingfaceSourceAdapter.js';
import type { SearchOpts } from '../../src/sources/sourceAdapter.js';

// mock httpGet
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

const baseOpts: SearchOpts = {
  intent: 'project',
  timeoutMs: 5000,
};

describe('HuggingfaceSourceAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('返回 HuggingFace 模型结果,含 name/url/description/stars/downloads', async () => {
    const mockResponse = [
      {
        id: 'bert-base-uncased',
        downloads: 50000000,
        likes: 1500,
        lastModified: '2024-06-01T00:00:00Z',
        pipeline_tag: 'fill-mask',
        library_name: 'transformers',
        tags: ['pytorch', 'tf', 'bert'],
      },
    ];
    (httpGet as any).mockResolvedValue(mockResponse);

    const adapter = new HuggingfaceSourceAdapter();
    const results = await adapter.search('bert fill mask', baseOpts);

    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('huggingface');
    expect(results[0].name).toBe('bert-base-uncased');
    expect(results[0].url).toBe('https://huggingface.co/bert-base-uncased');
    expect(results[0].stars).toBe(1500);
    expect((results[0] as any).downloads).toBe(50000000);
    expect((results[0] as any).pipelineTag).toBe('fill-mask');
  });

  it('description 含 pipeline_tag 和 library_name', async () => {
    const mockResponse = [
      {
        id: 'gpt2',
        downloads: 1000000,
        likes: 800,
        lastModified: '2024-06-01T00:00:00Z',
        pipeline_tag: 'text-generation',
        library_name: 'transformers',
        tags: [],
      },
    ];
    (httpGet as any).mockResolvedValue(mockResponse);

    const adapter = new HuggingfaceSourceAdapter();
    const results = await adapter.search('text generation', baseOpts);

    expect(results[0].description).toContain('text-generation');
    expect(results[0].description).toContain('transformers');
  });

  it('description 含 tags 摘要(取前 5 个)', async () => {
    const mockResponse = [
      {
        id: 'model-with-tags',
        downloads: 100,
        likes: 5,
        lastModified: '2024-06-01T00:00:00Z',
        tags: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7'],
      },
    ];
    (httpGet as any).mockResolvedValue(mockResponse);

    const adapter = new HuggingfaceSourceAdapter();
    const results = await adapter.search('model', baseOpts);

    expect(results[0].description).toContain('tag1, tag2, tag3, tag4, tag5');
    // tag6, tag7 不应出现(只取前 5 个)
    expect(results[0].description).not.toContain('tag6');
  });

  it('空结果时返回空数组', async () => {
    (httpGet as any).mockResolvedValue([]);

    const adapter = new HuggingfaceSourceAdapter();
    const results = await adapter.search('nonexistent', baseOpts);

    expect(results).toEqual([]);
  });

  it('API 返回非数组时容错为空数组', async () => {
    // 异常情况:API 返回了对象而非数组
    (httpGet as any).mockResolvedValue({ results: [] });

    const adapter = new HuggingfaceSourceAdapter();
    const results = await adapter.search('test', baseOpts);

    expect(results).toEqual([]);
  });

  it('字段缺失时用默认值填充', async () => {
    const mockResponse = [
      {
        id: 'minimal-model',
        // 缺少 downloads/likes/lastModified/tags
      },
    ];
    (httpGet as any).mockResolvedValue(mockResponse);

    const adapter = new HuggingfaceSourceAdapter();
    const results = await adapter.search('minimal', baseOpts);

    expect(results[0].stars).toBe(0);
    expect((results[0] as any).downloads).toBe(0);
    expect((results[0] as any).lastUpdated).toBe('');
    // description 应有兜底值
    expect(results[0].description).toBe('HuggingFace model');
  });

  it('HTTP 错误时抛 SourceError', async () => {
    const { HttpError } = await import('../../src/util/http.js');
    (httpGet as any).mockRejectedValue(new (HttpError as any)(500, 'https://huggingface.co/api/models', 'server error'));

    const adapter = new HuggingfaceSourceAdapter();
    await expect(adapter.search('test', baseOpts)).rejects.toThrow();
  });

  it('URL 含 search/limit/sort 参数', async () => {
    (httpGet as any).mockResolvedValue([]);

    const adapter = new HuggingfaceSourceAdapter();
    await adapter.search('image segmentation', baseOpts);

    const calledUrl = (httpGet as any).mock.calls[0][0];
    expect(calledUrl).toContain('search=image+segmentation');
    expect(calledUrl).toContain('limit=20');
    expect(calledUrl).toContain('sort=downloads');
    expect(calledUrl).toContain('direction=-1');
  });
});
