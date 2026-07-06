// tests/sources/rubygemsSourceAdapter.test.ts
// RubyGems 适配器测试
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RubyGemsSourceAdapter } from '../../src/sources/rubygemsSourceAdapter.js';
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

import { httpGet, HttpError } from '../../src/util/http.js';

const baseOpts: SearchOpts = {
  intent: 'project',
  timeoutMs: 5000,
};

describe('RubyGemsSourceAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('返回 RubyGems gem 结果,含 name/url/description/version/downloads', async () => {
    const mockResponse = [
      {
        name: 'rails',
        full_name: 'rails',
        version: '7.1.0',
        description: 'Full-stack web application framework.',
        summary: 'A web-application framework.',
        downloads: 100000000,
        version_created_at: '2023-10-01T00:00:00.000Z',
        version_downloads: 50000,
        homepage_uri: 'https://rubyonrails.org',
        source_code_uri: 'https://github.com/rails/rails',
        gem_uri: 'https://rubygems.org/gems/rails-7.1.0.gem',
        project_uri: 'https://rubygems.org/gems/rails',
        licenses: ['MIT'],
      },
    ];
    vi.mocked(httpGet).mockResolvedValue(mockResponse);

    const adapter = new RubyGemsSourceAdapter();
    const results = await adapter.search('rails web framework', baseOpts);

    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('rubygems');
    expect(results[0].name).toBe('rails');
    expect(results[0].url).toBe('https://rubygems.org/gems/rails');
    expect(results[0].description).toBe('Full-stack web application framework.');
    expect(results[0].version).toBe('7.1.0');
    expect((results[0] as any).downloads).toBe(100000000);
    expect((results[0] as any).updatedAt).toBe('2023-10-01T00:00:00.000Z');
    expect((results[0] as any).license).toBe('MIT');
    expect((results[0] as any).sourceCodeUri).toBe('https://github.com/rails/rails');
  });

  it('空结果时返回空数组', async () => {
    vi.mocked(httpGet).mockResolvedValue([]);

    const adapter = new RubyGemsSourceAdapter();
    const results = await adapter.search('nonexistentgem', baseOpts);

    expect(results).toEqual([]);
  });

  it('HTTP 错误时抛 SourceError', async () => {
    vi.mocked(httpGet).mockRejectedValue(
      new HttpError(500, 'https://rubygems.org/api/v1/search.json', 'server error'),
    );

    const adapter = new RubyGemsSourceAdapter();
    await expect(adapter.search('test', baseOpts)).rejects.toThrow();
  });

  it('description 为空时用 summary 替代', async () => {
    const mockResponse = [
      {
        name: 'minimal-gem',
        version: '1.0.0',
        description: '',
        summary: 'A minimal gem with only summary.',
        downloads: 1000,
        version_created_at: '2024-01-01T00:00:00.000Z',
        project_uri: 'https://rubygems.org/gems/minimal-gem',
        licenses: [],
      },
    ];
    vi.mocked(httpGet).mockResolvedValue(mockResponse);

    const adapter = new RubyGemsSourceAdapter();
    const results = await adapter.search('minimal', baseOpts);

    expect(results[0].description).toBe('A minimal gem with only summary.');
  });

  it('description 字段缺失时也用 summary', async () => {
    const mockResponse = [
      {
        name: 'no-desc-gem',
        version: '0.5.0',
        // 没有 description 字段
        summary: 'Summary only.',
        downloads: 500,
        version_created_at: '2024-02-01T00:00:00.000Z',
        project_uri: 'https://rubygems.org/gems/no-desc-gem',
      },
    ];
    vi.mocked(httpGet).mockResolvedValue(mockResponse);

    const adapter = new RubyGemsSourceAdapter();
    const results = await adapter.search('no desc', baseOpts);

    expect(results[0].description).toBe('Summary only.');
  });

  it('license 数组取第一个', async () => {
    const mockResponse = [
      {
        name: 'multi-license-gem',
        version: '2.0.0',
        description: 'A gem with multiple licenses.',
        downloads: 2000,
        version_created_at: '2024-03-01T00:00:00.000Z',
        project_uri: 'https://rubygems.org/gems/multi-license-gem',
        licenses: ['MIT', 'Apache-2.0'],
      },
    ];
    vi.mocked(httpGet).mockResolvedValue(mockResponse);

    const adapter = new RubyGemsSourceAdapter();
    const results = await adapter.search('multi license', baseOpts);

    expect((results[0] as any).license).toBe('MIT');
  });

  it('license 数组为空时 license 为 undefined', async () => {
    const mockResponse = [
      {
        name: 'no-license-gem',
        version: '0.1.0',
        description: 'A gem with no license.',
        downloads: 10,
        version_created_at: '2024-04-01T00:00:00.000Z',
        project_uri: 'https://rubygems.org/gems/no-license-gem',
        licenses: [],
      },
    ];
    vi.mocked(httpGet).mockResolvedValue(mockResponse);

    const adapter = new RubyGemsSourceAdapter();
    const results = await adapter.search('no license', baseOpts);

    expect((results[0] as any).license).toBeUndefined();
  });

  it('project_uri 缺失时 url 回退到 RubyGems 包页面', async () => {
    const mockResponse = [
      {
        name: 'fallback-gem',
        version: '1.0.0',
        description: 'A gem without project_uri.',
        downloads: 100,
        version_created_at: '2024-05-01T00:00:00.000Z',
        // project_uri 缺失
      },
    ];
    vi.mocked(httpGet).mockResolvedValue(mockResponse);

    const adapter = new RubyGemsSourceAdapter();
    const results = await adapter.search('fallback', baseOpts);

    expect(results[0].url).toBe('https://rubygems.org/gems/fallback-gem');
  });

  it('URL 含 query 参数', async () => {
    vi.mocked(httpGet).mockResolvedValue([]);

    const adapter = new RubyGemsSourceAdapter();
    await adapter.search('sinatra web', baseOpts);

    const calledUrl = vi.mocked(httpGet).mock.calls[0][0];
    expect(calledUrl).toContain('query=');
    expect(calledUrl).toContain('rubygems.org/api/v1/search.json');
  });

  it('API 返回非数组时容错为空数组', async () => {
    // 异常情况:API 返回了对象而非数组
    vi.mocked(httpGet).mockResolvedValue({ results: [] });

    const adapter = new RubyGemsSourceAdapter();
    const results = await adapter.search('test', baseOpts);

    expect(results).toEqual([]);
  });

  it('字段缺失时用默认值填充', async () => {
    const mockResponse = [
      {
        name: 'minimal-fields-gem',
        version: '0.0.1',
        // 缺少 downloads/version_created_at/licenses/description/summary
      },
    ];
    vi.mocked(httpGet).mockResolvedValue(mockResponse);

    const adapter = new RubyGemsSourceAdapter();
    const results = await adapter.search('minimal fields', baseOpts);

    expect((results[0] as any).downloads).toBe(0);
    expect((results[0] as any).updatedAt).toBe('');
    expect((results[0] as any).license).toBeUndefined();
    expect(results[0].description).toBe('');
  });
});
