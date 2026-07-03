// tests/util/http.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { httpGet, HttpError } from '../../src/util/http.js';

describe('httpGet', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed JSON on 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ hello: 'world' }),
    } as unknown as Response));
    const data = await httpGet('https://example.com', { timeoutMs: 1000 });
    expect(data).toEqual({ hello: 'world' });
  });

  it('throws HttpError on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers(),
      text: async () => 'forbidden',
    } as unknown as Response));
    await expect(httpGet('https://example.com', { timeoutMs: 1000 }))
      .rejects.toThrow(HttpError);
  });

  it('includes Authorization header when token provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({}),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    await httpGet('https://example.com', { timeoutMs: 1000, token: 'ghp_xxx' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ghp_xxx');
  });

  it('retries on 5xx then succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false, status: 503, headers: new Headers(),
        text: async () => 'service unavailable',
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ ok: true }),
      } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    const data = await httpGet('https://example.com', { timeoutMs: 1000, retry: { retries: 2, baseMs: 10 } });
    expect(data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 4xx (throws immediately)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 404, headers: new Headers(),
      text: async () => 'not found',
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    await expect(httpGet('https://example.com', { timeoutMs: 1000, retry: { retries: 2, baseMs: 10 } }))
      .rejects.toThrow(HttpError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('retries on network error (fetch rejects) then succeeds', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({
        ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ recovered: true }),
      } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    const data = await httpGet('https://example.com', { timeoutMs: 1000, retry: { retries: 2, baseMs: 10 } });
    expect(data).toEqual({ recovered: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry by default when no retry option', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(httpGet('https://example.com', { timeoutMs: 1000 }))
      .rejects.toThrow('fetch failed');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
