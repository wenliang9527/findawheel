// tests/sources/githubSourceAdapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubSourceAdapter, buildGithubQuery } from '../../src/sources/githubSourceAdapter.js';

describe('buildGithubQuery', () => {
  it('project intent searches name+description', () => {
    const q = buildGithubQuery('markdown editor', 'project', undefined);
    expect(q).toContain('markdown editor in:name,description');
    expect(q).toContain('sort:stars');
  });

  it('feature intent includes readme', () => {
    const q = buildGithubQuery('parse pdf', 'feature', undefined);
    expect(q).toContain('in:name,description,readme');
  });

  it('adds language filter when ecosystem provided', () => {
    const q = buildGithubQuery('markdown editor', 'project', 'js');
    expect(q).toContain('language:JavaScript');
  });
});

describe('GitHubSourceAdapter.search', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('parses GitHub response into RawResult[]', async () => {
    const fakeResponse = {
      total_count: 1,
      items: [{
        full_name: 'owner/repo',
        html_url: 'https://github.com/owner/repo',
        description: 'A markdown editor',
        stargazers_count: 100,
        language: 'TypeScript',
        license: { spdx_id: 'MIT' },
        archived: false,
        pushed_at: '2025-01-01T00:00:00Z',
        topics: ['editor'],
      }],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fakeResponse,
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new GitHubSourceAdapter();
    const results = await adapter.search('markdown editor', {
      intent: 'project', timeoutMs: 1000,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      source: 'github',
      name: 'owner/repo',
      url: 'https://github.com/owner/repo',
      description: 'A markdown editor',
      stars: 100,
      language: 'TypeScript',
      license: 'MIT',
      archived: false,
      pushedAt: '2025-01-01T00:00:00Z',
      topics: ['editor'],
    });
    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.pathname).toBe('/search/repositories');
  });

  it('throws RateLimitError on 403 with rate-limit header', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1735689600' }),
      text: async () => 'rate limited',
    } as unknown as Response));
    const adapter = new GitHubSourceAdapter();
    await expect(adapter.search('x', { intent: 'project', timeoutMs: 1000 }))
      .rejects.toThrow(/rate limited/i);
  });
});
