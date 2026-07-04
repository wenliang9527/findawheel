// tests/sources/papersWithCodeSourceAdapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PapersWithCodeSourceAdapter } from '../../src/sources/papersWithCodeSourceAdapter.js';

describe('PapersWithCodeSourceAdapter', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('GETs /api/v1/papers/ with query params', async () => {
    const fakeResponse = {
      count: 1,
      next: null,
      previous: null,
      results: [{
        id: 'attention-is-all-you-need',
        url_abs: 'https://arxiv.org/abs/1706.03762',
        url_pdf: 'https://arxiv.org/pdf/1706.03762',
        title: 'Attention Is All You Need',
        abstract: 'The dominant sequence transduction models...',
        published: '2017-06-12',
        authors: ['Vaswani et al.'],
        proceeding: null,
      }],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fakeResponse,
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new PapersWithCodeSourceAdapter();
    const results = await adapter.search('transformer attention', {
      intent: 'feature', timeoutMs: 5000,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      source: 'paperswithcode',
      name: 'Attention Is All You Need',
      url: 'https://paperswithcode.com/paper/attention-is-all-you-need',
      description: 'The dominant sequence transduction models...',
      year: 2017,
      repoUrl: 'https://arxiv.org/abs/1706.03762',
    });

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.pathname).toBe('/api/v1/papers/');
    expect(calledUrl.searchParams.get('q')).toBe('transformer attention');
    expect(calledUrl.searchParams.get('page')).toBe('1');
    expect(calledUrl.searchParams.get('items_per_page')).toBe('20');
  });

  it('handles empty results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ count: 0, next: null, previous: null, results: [] }),
    } as unknown as Response));

    const adapter = new PapersWithCodeSourceAdapter();
    const results = await adapter.search('nonexistent', { intent: 'feature', timeoutMs: 5000 });
    expect(results).toEqual([]);
  });

  it('handles missing results array gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({}),
    } as unknown as Response));

    const adapter = new PapersWithCodeSourceAdapter();
    const results = await adapter.search('x', { intent: 'feature', timeoutMs: 5000 });
    expect(results).toEqual([]);
  });

  it('extracts year from YYYY format published', async () => {
    const fakeResponse = {
      count: 1, next: null, previous: null,
      results: [{
        id: 'x', title: 'X', abstract: 'abs',
        published: '2020', authors: [],
      }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fakeResponse,
    } as unknown as Response));

    const adapter = new PapersWithCodeSourceAdapter();
    const results = await adapter.search('x', { intent: 'feature', timeoutMs: 5000 });
    expect(results[0].year).toBe(2020);
  });

  it('handles paper without published field', async () => {
    const fakeResponse = {
      count: 1, next: null, previous: null,
      results: [{ id: 'x', title: 'X', abstract: '' }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fakeResponse,
    } as unknown as Response));

    const adapter = new PapersWithCodeSourceAdapter();
    const results = await adapter.search('x', { intent: 'feature', timeoutMs: 5000 });
    expect(results[0].year).toBeUndefined();
    expect(results[0].repoUrl).toBeUndefined();
  });

  it('throws SourceError on HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500,
      headers: new Headers(),
      text: async () => 'server error',
    } as unknown as Response));

    const adapter = new PapersWithCodeSourceAdapter();
    await expect(adapter.search('x', { intent: 'feature', timeoutMs: 5000 }))
      .rejects.toThrow(/paperswithcode/);
  });

  it('throws SourceError on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    const adapter = new PapersWithCodeSourceAdapter();
    await expect(adapter.search('x', { intent: 'feature', timeoutMs: 5000 }))
      .rejects.toThrow(/paperswithcode/);
  });
});
