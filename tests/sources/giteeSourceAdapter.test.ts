// tests/sources/giteeSourceAdapter.test.ts
// Gitee 搜索源适配器单元测试。
// 参考同类测试 huggingfaceSourceAdapter.test.ts 的 mock 风格。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GiteeSourceAdapter } from '../../src/sources/giteeSourceAdapter.js';
import type { SearchOpts } from '../../src/sources/sourceAdapter.js';
import { RateLimitError, SourceError } from '../../src/errors.js';

// mock httpGet / HttpError:路径相对测试文件解析到 src/util/http.js
vi.mock('../../src/util/http.js', () => ({
  httpGet: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, public url: string, body: string) {
      super(`HTTP ${status} from ${url}: ${body.slice(0, 200)}`);
      this.name = 'HttpError';
    }
    get retryable(): boolean { return this.status >= 500; }
  },
}));

import { httpGet, HttpError } from '../../src/util/http.js';

const baseOpts: SearchOpts = {
  intent: 'project',
  timeoutMs: 5000,
};

// Gitee API v5 search/repositories 样本响应
function sampleGiteeResponse() {
  return {
    total_count: 1,
    items: [
      {
        full_name: 'owner/repo',
        human_name: 'repo',
        html_url: 'https://gitee.com/owner/repo',
        description: 'A markdown editor',
        stargazers_count: 100,
        language: 'TypeScript',
        license: { name: 'MIT' },
        updated_at: '2025-01-01T00:00:00Z',
        project_creator: 'owner',
      },
    ],
  };
}

describe('GiteeSourceAdapter.search', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('基本调用:解析 GiteeSearchResponse 为 RawResult[]', async () => {
    vi.mocked(httpGet).mockResolvedValue(sampleGiteeResponse());

    const adapter = new GiteeSourceAdapter();
    const results = await adapter.search('markdown editor', baseOpts);

    expect(results).toHaveLength(1);
    // 校验 httpGet 被调用一次,且是字符串 URL
    expect(httpGet).toHaveBeenCalledTimes(1);
    expect(typeof vi.mocked(httpGet).mock.calls[0][0]).toBe('string');
  });

  it('字段映射正确:name/url/description/stars/language/license/updatedAt/humanName', async () => {
    vi.mocked(httpGet).mockResolvedValue(sampleGiteeResponse());

    const adapter = new GiteeSourceAdapter();
    const results = await adapter.search('markdown editor', baseOpts);

    expect(results[0]).toEqual({
      source: 'gitee',
      name: 'owner/repo',
      url: 'https://gitee.com/owner/repo',
      description: 'A markdown editor',
      stars: 100,
      language: 'TypeScript',
      license: 'MIT',
      updatedAt: '2025-01-01T00:00:00Z',
      humanName: 'repo',
    });
  });

  it('description 为 null 时兜底为空字符串', async () => {
    const resp = {
      total_count: 1,
      items: [
        {
          full_name: 'foo/bar',
          human_name: 'bar',
          html_url: 'https://gitee.com/foo/bar',
          description: null,
          stargazers_count: 0,
          language: null,
          license: null,
          updated_at: '2025-06-01T00:00:00Z',
        },
      ],
    };
    vi.mocked(httpGet).mockResolvedValue(resp);

    const adapter = new GiteeSourceAdapter();
    const results = await adapter.search('foo', baseOpts);

    expect(results[0].description).toBe('');
    expect(results[0].license).toBeNull();
    expect(results[0].language).toBeNull();
  });

  it('URL 含 q/sort/order/per_page 参数,且走 /api/v5/search/repositories', async () => {
    vi.mocked(httpGet).mockResolvedValue({ items: [] });

    const adapter = new GiteeSourceAdapter();
    await adapter.search('markdown editor', baseOpts);

    const calledUrl = new URL(vi.mocked(httpGet).mock.calls[0][0] as string);
    expect(calledUrl.pathname).toBe('/api/v5/search/repositories');
    expect(calledUrl.searchParams.get('q')).toBe('markdown editor');
    // sort 用 Gitee API v5 合法值 stars_count(实测 sort=stars 返回 400,stars_count 返回 200)
    expect(calledUrl.searchParams.get('sort')).toBe('stars_count');
    expect(calledUrl.searchParams.get('order')).toBe('desc');
    expect(calledUrl.searchParams.get('per_page')).toBe('20');
    // 默认不传 token
    expect(calledUrl.searchParams.has('access_token')).toBe(false);
    // 默认不传 language
    expect(calledUrl.searchParams.has('language')).toBe(false);
  });

  it('ecosystem=js → language=JavaScript', async () => {
    vi.mocked(httpGet).mockResolvedValue({ items: [] });

    const adapter = new GiteeSourceAdapter();
    await adapter.search('editor', { ...baseOpts, ecosystem: 'js' });

    const calledUrl = new URL(vi.mocked(httpGet).mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get('language')).toBe('JavaScript');
  });

  it('ecosystem=python → language=Python', async () => {
    vi.mocked(httpGet).mockResolvedValue({ items: [] });

    const adapter = new GiteeSourceAdapter();
    await adapter.search('parse', { ...baseOpts, ecosystem: 'python' });

    const calledUrl = new URL(vi.mocked(httpGet).mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get('language')).toBe('Python');
  });

  it('ecosystem=cpp → language=C++', async () => {
    vi.mocked(httpGet).mockResolvedValue({ items: [] });

    const adapter = new GiteeSourceAdapter();
    await adapter.search('stepper', { ...baseOpts, ecosystem: 'cpp' });

    const calledUrl = new URL(vi.mocked(httpGet).mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get('language')).toBe('C++');
  });

  it('ecosystem=arduino → language=Arduino', async () => {
    vi.mocked(httpGet).mockResolvedValue({ items: [] });

    const adapter = new GiteeSourceAdapter();
    await adapter.search('sensor', { ...baseOpts, ecosystem: 'arduino' });

    const calledUrl = new URL(vi.mocked(httpGet).mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get('language')).toBe('Arduino');
  });

  it('ecosystem=c 不映射(不传 language,符合 ECOSYSTEM_LANG 表)', async () => {
    // ECOSYSTEM_LANG 故意不含 'c':单片机 C 项目语言标注混乱
    vi.mocked(httpGet).mockResolvedValue({ items: [] });

    const adapter = new GiteeSourceAdapter();
    await adapter.search('motor', { ...baseOpts, ecosystem: 'c' });

    const calledUrl = new URL(vi.mocked(httpGet).mock.calls[0][0] as string);
    expect(calledUrl.searchParams.has('language')).toBe(false);
  });

  it('空结果(空 items 数组)返回空数组', async () => {
    vi.mocked(httpGet).mockResolvedValue({ total_count: 0, items: [] });

    const adapter = new GiteeSourceAdapter();
    const results = await adapter.search('nonexistent', baseOpts);

    expect(results).toEqual([]);
  });

  it('items 缺失时容错为空数组', async () => {
    // 异常情况:响应里没有 items 字段
    vi.mocked(httpGet).mockResolvedValue({ total_count: 0 });

    const adapter = new GiteeSourceAdapter();
    const results = await adapter.search('whatever', baseOpts);

    expect(results).toEqual([]);
  });

  it('限流错误(403)抛 RateLimitError', async () => {
    vi.mocked(httpGet).mockRejectedValue(
      new HttpError(403, 'https://gitee.com/api/v5/search/repositories', 'rate limited'),
    );

    const adapter = new GiteeSourceAdapter();
    await expect(adapter.search('x', baseOpts)).rejects.toBeInstanceOf(RateLimitError);
  });

  it('其他 HttpError 抛 SourceError(如 500)', async () => {
    vi.mocked(httpGet).mockRejectedValue(
      new HttpError(500, 'https://gitee.com/api/v5/search/repositories', 'server error'),
    );

    const adapter = new GiteeSourceAdapter();
    await expect(adapter.search('x', baseOpts)).rejects.toBeInstanceOf(SourceError);
    await expect(adapter.search('x', baseOpts)).rejects.not.toBeInstanceOf(RateLimitError);
  });

  it('404 HttpError 抛 SourceError 含 HTTP 404', async () => {
    vi.mocked(httpGet).mockRejectedValue(
      new HttpError(404, 'https://gitee.com/api/v5/search/repositories', 'not found'),
    );

    const adapter = new GiteeSourceAdapter();
    await expect(adapter.search('x', baseOpts)).rejects.toThrow(/HTTP 404/);
  });

  it('非 HttpError 异常包装成 SourceError', async () => {
    vi.mocked(httpGet).mockRejectedValue(new Error('network down'));

    const adapter = new GiteeSourceAdapter();
    await expect(adapter.search('x', baseOpts)).rejects.toBeInstanceOf(SourceError);
    await expect(adapter.search('x', baseOpts)).rejects.toThrow(/network down/);
  });

  it('token 注入:传 giteeToken 时 URL 带 access_token 查询参数', async () => {
    vi.mocked(httpGet).mockResolvedValue({ items: [] });

    const adapter = new GiteeSourceAdapter();
    await adapter.search('editor', { ...baseOpts, giteeToken: 'gitee_token_xxx' });

    const calledUrl = new URL(vi.mocked(httpGet).mock.calls[0][0] as string);
    // Gitee API v5 标准做法:access_token 作为 query 参数(非 Authorization header)
    expect(calledUrl.searchParams.get('access_token')).toBe('gitee_token_xxx');
  });

  it('parsedQuery.expandedQuery 优先于 translateQuery', async () => {
    vi.mocked(httpGet).mockResolvedValue({ items: [] });

    const adapter = new GiteeSourceAdapter();
    await adapter.search('原文 query', {
      ...baseOpts,
      parsedQuery: {
        corePhrase: '原文',
        coreWords: ['原文'],
        modifiers: [],
        expandedQuery: 'custom expanded query',
        formatWords: [],
      } as any,
    });

    const calledUrl = new URL(vi.mocked(httpGet).mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get('q')).toBe('custom expanded query');
  });
});
