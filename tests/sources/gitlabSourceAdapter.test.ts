// tests/sources/gitlabSourceAdapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitlabSourceAdapter } from '../../src/sources/gitlabSourceAdapter.js';

describe('GitlabSourceAdapter.search', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('parses GitLab /projects response into GitlabRawResult[]', async () => {
    // GitLab /api/v4/projects 返回数组(非 GitHub 的 { items } 对象包裹)
    const fakeResponse = [{
      id: 12345,
      name: 'myrepo',
      path_with_namespace: 'group/myrepo',
      web_url: 'https://gitlab.com/group/myrepo',
      description: 'A markdown editor',
      star_count: 200,
      last_activity_at: '2025-06-01T00:00:00Z',
      topics: ['editor', 'markdown'],
      archived: false,
    }];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fakeResponse,
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new GitlabSourceAdapter();
    const results = await adapter.search('markdown editor', {
      intent: 'project', timeoutMs: 1000,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      source: 'gitlab',
      name: 'group/myrepo',
      url: 'https://gitlab.com/group/myrepo',
      description: 'A markdown editor',
      stars: 200,
      lastActivityAt: '2025-06-01T00:00:00Z',
      topics: ['editor', 'markdown'],
      archived: false,
    });
    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.pathname).toBe('/api/v4/projects');
    expect(calledUrl.searchParams.get('search')).toBe('markdown editor');
    expect(calledUrl.searchParams.get('order_by')).toBe('star_count');
    expect(calledUrl.searchParams.get('sort')).toBe('desc');
    expect(calledUrl.searchParams.get('per_page')).toBe('50');
  });

  it('translates Chinese query to English before searching', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => [],
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new GitlabSourceAdapter();
    await adapter.search('图片水印', { intent: 'feature', timeoutMs: 1000 });
    const search = fetchMock.mock.calls[0][0] as string;
    // translateQuery 会把中文翻译成英文,最终 search 参数应包含 image/watermark
    expect(search).toMatch(/image/);
    expect(search).toMatch(/watermark/);
  });

  it('sends PRIVATE-TOKEN header when gitlabToken provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => [],
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new GitlabSourceAdapter();
    await adapter.search('x', { intent: 'project', timeoutMs: 1000, gitlabToken: 'glpat_xxx' });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['private-token']).toBe('glpat_xxx');
  });

  it('throws RateLimitError on 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 429, headers: new Headers(),
      text: async () => 'rate limited',
    } as unknown as Response));
    const adapter = new GitlabSourceAdapter();
    await expect(adapter.search('x', { intent: 'project', timeoutMs: 1000 }))
      .rejects.toThrow(/rate limited/i);
  });

  it('returns empty array when response is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => [],
    } as unknown as Response));
    const adapter = new GitlabSourceAdapter();
    const results = await adapter.search('nonexistent', { intent: 'project', timeoutMs: 1000 });
    expect(results).toEqual([]);
  });

  it('normalizes null description to empty string', async () => {
    const fakeResponse = [{
      id: 1, name: 'r', path_with_namespace: 'g/r', web_url: 'https://gitlab.com/g/r',
      description: null, star_count: 0, last_activity_at: '2025-01-01T00:00:00Z',
      topics: [], archived: false,
    }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fakeResponse,
    } as unknown as Response));
    const adapter = new GitlabSourceAdapter();
    const results = await adapter.search('x', { intent: 'project', timeoutMs: 1000 });
    expect(results[0].description).toBe('');
  });
});
