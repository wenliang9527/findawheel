// tests/sources/vscodeMarketplaceSourceAdapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VscodeMarketplaceSourceAdapter } from '../../src/sources/vscodeMarketplaceSourceAdapter.js';

describe('VscodeMarketplaceSourceAdapter', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to extensionquery endpoint with correct body', async () => {
    const fakeResponse = {
      results: [{
        extensions: [{
          publisherId: '111',
          publisherName: 'ms-python',
          publisherDisplayName: 'Microsoft',
          extensionName: 'python',
          displayName: 'Python',
          flags: '',
          shortDescription: 'IntelliSense, linting, debugging',
          versions: [{ version: '2024.0.0', lastUpdated: '2025-06-01T00:00:00Z', assetUri: '' }],
          statistics: [
            { statisticName: 'install', value: 100000000 },
            { statisticName: 'averagerating', value: 4.5 },
            { statisticName: 'ratingcount', value: 1000 },
          ],
          tags: [],
        }],
        resultMetadata: [],
      }],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fakeResponse,
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new VscodeMarketplaceSourceAdapter();
    const results = await adapter.search('python', {
      intent: 'feature', timeoutMs: 5000,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      source: 'vscode-marketplace',
      name: 'ms-python.python',
      url: 'https://marketplace.visualstudio.com/items?itemName=ms-python.python',
      description: 'Python - IntelliSense, linting, debugging',
      installCount: 100000000,
      averageRating: 4.5,
      ratingCount: 1000,
      lastUpdated: '2025-06-01T00:00:00Z',
      publisher: 'ms-python',
    });

    // 验证 POST 调用
    expect(fetchMock.mock.calls[0][0]).toBe('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery');
    const callOpts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(callOpts.method).toBe('POST');
    const body = JSON.parse(callOpts.body as string);
    expect(body.filters[0].criteria).toContainEqual({ filterType: 8, value: 'python' });
    expect(body.filters[0].criteria).toContainEqual({ filterType: 12, value: 'Microsoft.VisualStudio.Code' });
    expect(body.flags).toBe(914);
    const headers = callOpts.headers as Record<string, string>;
    expect(headers['accept']).toContain('api-version=3.0-preview.1');
  });

  it('handles empty extensions array gracefully', async () => {
    const fakeResponse = { results: [{ extensions: [], resultMetadata: [] }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fakeResponse,
    } as unknown as Response));

    const adapter = new VscodeMarketplaceSourceAdapter();
    const results = await adapter.search('nonexistent', { intent: 'feature', timeoutMs: 5000 });
    expect(results).toEqual([]);
  });

  it('handles missing results array', async () => {
    const fakeResponse = {};
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fakeResponse,
    } as unknown as Response));

    const adapter = new VscodeMarketplaceSourceAdapter();
    const results = await adapter.search('x', { intent: 'feature', timeoutMs: 5000 });
    expect(results).toEqual([]);
  });

  it('handles extension without statistics', async () => {
    const fakeResponse = {
      results: [{
        extensions: [{
          publisherName: 'foo',
          extensionName: 'bar',
          displayName: '',
          shortDescription: 'no stats',
          versions: [{ version: '1.0', lastUpdated: '2025-01-01T00:00:00Z', assetUri: '' }],
          statistics: [],
          tags: [],
        }],
        resultMetadata: [],
      }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fakeResponse,
    } as unknown as Response));

    const adapter = new VscodeMarketplaceSourceAdapter();
    const results = await adapter.search('x', { intent: 'feature', timeoutMs: 5000 });
    expect(results).toHaveLength(1);
    expect(results[0].installCount).toBe(0);
    expect(results[0].averageRating).toBeUndefined();
    expect(results[0].ratingCount).toBeUndefined();
    expect(results[0].description).toBe('no stats');  // displayName 空,用 shortDescription
  });

  it('throws SourceError on HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500,
      headers: new Headers(),
      text: async () => 'server error',
    } as unknown as Response));

    const adapter = new VscodeMarketplaceSourceAdapter();
    await expect(adapter.search('x', { intent: 'feature', timeoutMs: 5000 }))
      .rejects.toThrow(/vscode-marketplace/);
  });

  it('throws SourceError on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    const adapter = new VscodeMarketplaceSourceAdapter();
    await expect(adapter.search('x', { intent: 'feature', timeoutMs: 5000 }))
      .rejects.toThrow(/vscode-marketplace/);
  });
});
