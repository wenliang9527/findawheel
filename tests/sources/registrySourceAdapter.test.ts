// tests/sources/registrySourceAdapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RegistrySourceAdapter } from '../../src/sources/registrySourceAdapter.js';

describe('RegistrySourceAdapter.search', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('queries npm when ecosystem is js', async () => {
    const npmResp = {
      objects: [{
        package: {
          name: 'lodash',
          version: '4.17.21',
          description: 'Utility library',
          links: { npm: 'https://www.npmjs.com/package/lodash' },
          keywords: ['utils'],
          date: '2024-01-01T00:00:00Z',
        },
      }],
      total: 1,
    };
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('https://registry.npmjs.org')) {
        return Promise.resolve({
          ok: true, status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => npmResp,
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ crates: [] }),
      } as unknown as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new RegistrySourceAdapter();
    const results = await adapter.search('utility library', {
      intent: 'feature', ecosystem: 'js', timeoutMs: 1000,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      source: 'npm',
      name: 'lodash',
      description: 'Utility library',
    });
  });

  it('queries crates.io when ecosystem is rust', async () => {
    const cratesResp = {
      crates: [{
        id: 'serde',
        name: 'serde',
        description: 'Serialization framework',
        max_version: '1.0.0',
        downloads: 1000000,
        recent_downloads: 50000,
        updated_at: '2025-01-01T00:00:00Z',
        repository: 'https://github.com/serde-rs/serde',
      }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => cratesResp,
    } as unknown as Response));

    const adapter = new RegistrySourceAdapter();
    const results = await adapter.search('serialization', {
      intent: 'feature', ecosystem: 'rust', timeoutMs: 1000,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      source: 'crates', name: 'serde', downloads: 1000000,
    });
  });

  it('skips PyPI (returns empty for python)', async () => {
    const adapter = new RegistrySourceAdapter();
    const results = await adapter.search('something', {
      intent: 'feature', ecosystem: 'python', timeoutMs: 1000,
    });
    expect(results).toEqual([]);
  });

  it('queries both npm and crates when no ecosystem specified', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const resp = url.startsWith('https://registry.npmjs.org')
        ? { objects: [], total: 0 }
        : { crates: [] };
      return Promise.resolve({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => resp,
      } as unknown as Response);
    });
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new RegistrySourceAdapter();
    await adapter.search('lib', { intent: 'feature', timeoutMs: 1000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
