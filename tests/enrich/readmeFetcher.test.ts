// tests/enrich/readmeFetcher.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchReadme } from '../../src/enrich/readmeFetcher.js';

describe('fetchReadme', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('fetches README and truncates to maxLines', async () => {
    const longText = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'text/plain' }),
      text: async () => longText,
    } as unknown as Response));
    const result = await fetchReadme('owner/repo', { timeoutMs: 1000, maxLines: 10 });
    expect(result.split('\n')).toHaveLength(10);
    expect(result).toContain('line 0');
    expect(result).toContain('line 9');
    expect(result).not.toContain('line 10');
  });

  it('defaults to 30 lines when maxLines not specified', async () => {
    const longText = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers(),
      text: async () => longText,
    } as unknown as Response));
    const result = await fetchReadme('owner/repo', { timeoutMs: 1000 });
    expect(result.split('\n')).toHaveLength(30);
  });

  it('returns empty string on 404 (no README)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 404, headers: new Headers(),
      text: async () => 'not found',
    } as unknown as Response));
    const result = await fetchReadme('owner/repo', { timeoutMs: 1000 });
    expect(result).toBe('');
  });

  it('sends githubToken as Bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers(),
      text: async () => 'readme content',
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    await fetchReadme('owner/repo', { timeoutMs: 1000, githubToken: 'ghp_xxx' });
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer ghp_xxx');
  });

  it('uses raw accept header to get markdown source', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers(),
      text: async () => 'readme',
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    await fetchReadme('o/r', { timeoutMs: 1000 });
    expect(fetchMock.mock.calls[0][1].headers.accept).toBe('application/vnd.github.raw');
  });

  it('throws SourceError on 500 (non-404 HTTP error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500, headers: new Headers(),
      text: async () => 'server error',
    } as unknown as Response));
    await expect(fetchReadme('owner/repo', { timeoutMs: 1000 }))
      .rejects.toThrow(/github/i);
  });

  it('calls correct GitHub readme URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers(),
      text: async () => 'readme',
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    await fetchReadme('expressjs/express', { timeoutMs: 1000 });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/expressjs/express/readme');
  });
});
