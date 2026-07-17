// tests/sources/githubCodeSourceAdapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubCodeSourceAdapter, buildGithubCodeQuery } from '../../src/sources/githubCodeSourceAdapter.js';

describe('buildGithubCodeQuery', () => {
  it('returns query as-is when no ecosystem', () => {
    expect(buildGithubCodeQuery('addClass', undefined)).toBe('addClass');
  });

  it('appends language filter for js ecosystem', () => {
    expect(buildGithubCodeQuery('addClass', 'js')).toBe('addClass language:JavaScript');
  });

  it('appends language filter for python ecosystem', () => {
    expect(buildGithubCodeQuery('parse input', 'python')).toBe('parse input language:Python');
  });

  it('ignores unknown ecosystem', () => {
    expect(buildGithubCodeQuery('foo', 'haskell')).toBe('foo');
  });
});

describe('GitHubCodeSourceAdapter', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns empty array when no githubToken (auth required)', async () => {
    const adapter = new GitHubCodeSourceAdapter();
    const results = await adapter.search('addClass', {
      intent: 'feature', timeoutMs: 1000,
    });
    expect(results).toEqual([]);
  });

  it('maps code search response to GitHubCodeRawResult', async () => {
    const fakeResponse = {
      total_count: 1,
      items: [{
        name: 'parser.ts',
        path: 'src/parser.ts',
        sha: 'abc123',
        url: 'https://api.github.com/repos/foo/bar/contents/src/parser.ts',
        html_url: 'https://github.com/foo/bar/blob/main/src/parser.ts',
        repository: {
          full_name: 'foo/bar',
          description: 'A parser lib',
          stargazers_count: 200,
          language: 'TypeScript',
          pushed_at: '2025-06-01T00:00:00Z',
        },
        score: 1.5,
        text_matches: [{
          object_url: 'https://api.github.com/repos/foo/bar/contents/src/parser.ts',
          property: 'content',
          fragment: 'function parse(input) { return input.split(","); }',
          matches: [{ text: 'parse', indices: [9, 14] }],
        }],
      }],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fakeResponse,
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new GitHubCodeSourceAdapter();
    const results = await adapter.search('parse', {
      intent: 'feature', timeoutMs: 1000, githubToken: 'ghp_xxx',
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      source: 'github-code',
      name: 'foo/bar',
      url: 'https://github.com/foo/bar/blob/main/src/parser.ts',
      path: 'src/parser.ts',
      description: 'A parser lib',
      stars: 200,
      language: 'TypeScript',
      textFragment: 'function parse(input) { return input.split(","); }',
      pushedAt: '2025-06-01T00:00:00Z',
    });

    // 验证 URL 和 accept header
    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.pathname).toBe('/search/code');
    expect(calledUrl.searchParams.get('q')).toBe('parse');
    expect(calledUrl.searchParams.get('per_page')).toBe('100');
    const callOpts = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = callOpts.headers as Record<string, string>;
    expect(headers['accept']).toBe('application/vnd.github.text-match+json');
    expect(headers['authorization']).toBe('Bearer ghp_xxx');
  });

  it('handles items without text_matches', async () => {
    const fakeResponse = {
      total_count: 1,
      items: [{
        name: 'x.ts', path: 'x.ts', sha: '', url: '',
        html_url: 'https://github.com/foo/baz/blob/main/x.ts',
        repository: {
          full_name: 'foo/baz', description: null,
          stargazers_count: 0, language: null,
          pushed_at: '2025-01-01T00:00:00Z',
        },
        score: 1,
      }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fakeResponse,
    } as unknown as Response));

    const adapter = new GitHubCodeSourceAdapter();
    const results = await adapter.search('x', {
      intent: 'feature', timeoutMs: 1000, githubToken: 'ghp_xxx',
    });
    expect(results).toHaveLength(1);
    expect(results[0].textFragment).toBeUndefined();
    expect(results[0].description).toBe('');
  });

  it('throws RateLimitError on 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 403,
      headers: new Headers({ 'x-ratelimit-remaining': '0' }),
      text: async () => 'rate limited',
    } as unknown as Response));
    const adapter = new GitHubCodeSourceAdapter();
    await expect(adapter.search('x', {
      intent: 'feature', timeoutMs: 1000, githubToken: 'ghp_xxx',
    })).rejects.toThrow(/rate limited/i);
  });

  it('throws SourceError on 422 (validation failed)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 422,
      headers: new Headers(),
      text: async () => 'Validation failed',
    } as unknown as Response));
    const adapter = new GitHubCodeSourceAdapter();
    await expect(adapter.search('x', {
      intent: 'feature', timeoutMs: 1000, githubToken: 'ghp_xxx',
    })).rejects.toThrow(/github-code/);
  });
});
