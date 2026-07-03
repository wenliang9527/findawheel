// tests/enrich/releaseFetcher.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchLatestRelease } from '../../src/enrich/releaseFetcher.js';

describe('fetchLatestRelease', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns mapped release on 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ tag_name: 'v1.0.0', published_at: '2024-01-01T00:00:00Z', name: 'Release 1.0' }),
    } as unknown as Response));
    const result = await fetchLatestRelease('owner/repo', { timeoutMs: 1000 });
    expect(result).not.toBeNull();
    expect(result?.tag).toBe('v1.0.0');
    expect(result?.publishedAt).toBe('2024-01-01T00:00:00Z');
    expect(result?.name).toBe('Release 1.0');
  });

  it('omits name when null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers(),
      json: async () => ({ tag_name: 'v2.0.0', published_at: '2024-02-01T00:00:00Z', name: null }),
    } as unknown as Response));
    const result = await fetchLatestRelease('owner/repo', { timeoutMs: 1000 });
    expect(result).not.toBeNull();
    expect(result?.tag).toBe('v2.0.0');
    expect(result?.name).toBeUndefined();
  });

  it('returns null on 404 (no release)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 404, headers: new Headers(),
      text: async () => 'not found',
    } as unknown as Response));
    const result = await fetchLatestRelease('owner/repo', { timeoutMs: 1000 });
    expect(result).toBeNull();
  });

  it('sends githubToken as Bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers(),
      json: async () => ({ tag_name: 'v1.0.0', published_at: '2024-01-01T00:00:00Z', name: 'Release 1.0' }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    await fetchLatestRelease('owner/repo', { timeoutMs: 1000, githubToken: 'ghp_xxx' });
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer ghp_xxx');
  });

  it('throws SourceError on 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500, headers: new Headers(),
      text: async () => 'server error',
    } as unknown as Response));
    await expect(fetchLatestRelease('owner/repo', { timeoutMs: 1000 }))
      .rejects.toThrow(/github/i);
  });

  it('calls correct GitHub releases/latest URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers(),
      json: async () => ({ tag_name: 'v1.0.0', published_at: '2024-01-01T00:00:00Z', name: null }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    await fetchLatestRelease('owner/repo', { timeoutMs: 1000 });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/owner/repo/releases/latest');
  });
});
