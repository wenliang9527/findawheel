// tests/sources/librariesIoSourceAdapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LibrariesIoSourceAdapter } from '../../src/sources/librariesIoSourceAdapter.js';

describe('LibrariesIoSourceAdapter.search', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns empty array when no API key (skip)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new LibrariesIoSourceAdapter();
    const results = await adapter.search('express', { intent: 'project', timeoutMs: 1000 });
    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parses Libraries.io response into LibrariesIoRawResult[]', async () => {
    const fakeResponse = [{
      name: 'express',
      platform: 'npm',
      description: 'Fast web framework',
      homepage: 'https://github.com/expressjs/express',
      repository_url: 'https://github.com/expressjs/express',
      language: 'JavaScript',
      stars: 50000,
      latest_release_published_at: '2024-01-01T00:00:00Z',
    }];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fakeResponse,
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new LibrariesIoSourceAdapter();
    const results = await adapter.search('express', {
      intent: 'project', timeoutMs: 1000, librariesIoApiKey: 'lib_key',
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      source: 'librariesio',
      name: 'express',
      url: 'https://github.com/expressjs/express',
      description: 'Fast web framework',
      stars: 50000,
      language: 'JavaScript',
      platform: 'npm',
      lastUpdated: '2024-01-01T00:00:00Z',
    });
  });

  it('includes api_key in URL params', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => [],
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new LibrariesIoSourceAdapter();
    await adapter.search('x', { intent: 'project', timeoutMs: 1000, librariesIoApiKey: 'secret123' });
    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get('api_key')).toBe('secret123');
    expect(calledUrl.pathname).toBe('/api/search');
  });

  it('translates Chinese query to English', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => [],
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new LibrariesIoSourceAdapter();
    await adapter.search('图片水印', { intent: 'feature', timeoutMs: 1000, librariesIoApiKey: 'k' });
    const q = new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('q') ?? '';
    expect(q).toMatch(/image/);
    expect(q).toMatch(/watermark/);
  });

  it('falls back to repository_url when homepage missing', async () => {
    const fakeResponse = [{
      name: 'pkg', platform: 'pypi', description: 'd',
      homepage: null, repository_url: 'https://github.com/x/pkg',
      language: 'Python', stars: 10, latest_release_published_at: null,
    }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fakeResponse,
    } as unknown as Response));
    const adapter = new LibrariesIoSourceAdapter();
    const results = await adapter.search('x', { intent: 'project', timeoutMs: 1000, librariesIoApiKey: 'k' });
    expect(results[0].url).toBe('https://github.com/x/pkg');
    expect(results[0].lastUpdated).toBeNull();
  });

  it('falls back to libraries.io URL when both homepage and repo missing', async () => {
    const fakeResponse = [{
      name: 'pkg', platform: 'npm', description: null,
      homepage: null, repository_url: null,
      language: null, stars: null, latest_release_published_at: null,
    }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fakeResponse,
    } as unknown as Response));
    const adapter = new LibrariesIoSourceAdapter();
    const results = await adapter.search('x', { intent: 'project', timeoutMs: 1000, librariesIoApiKey: 'k' });
    expect(results[0].url).toBe('https://libraries.io/npm/pkg');
    expect(results[0].stars).toBe(0);
    expect(results[0].description).toBe('');
  });

  it('throws SourceError on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 401, headers: new Headers(),
      text: async () => 'unauthorized',
    } as unknown as Response));
    const adapter = new LibrariesIoSourceAdapter();
    await expect(adapter.search('x', { intent: 'project', timeoutMs: 1000, librariesIoApiKey: 'bad' }))
      .rejects.toThrow(/librariesio/i);
  });
});
