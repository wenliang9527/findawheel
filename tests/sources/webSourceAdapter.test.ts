// tests/sources/webSourceAdapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock httpPost before importing the adapter
vi.mock('../../src/util/http.js', () => ({
  httpPost: vi.fn(),
}));

import { httpPost } from '../../src/util/http.js';
import { WebSourceAdapter } from '../../src/sources/webSourceAdapter.js';
import type { SearchOpts } from '../../src/sources/sourceAdapter.js';

const baseOpts: SearchOpts = {
  intent: 'project',
  ecosystem: undefined,
  timeoutMs: 5000,
  githubToken: undefined,
  gitlabToken: undefined,
  giteeToken: undefined,
  librariesIoApiKey: undefined,
  exaApiKey: undefined,
  tavilyApiKey: undefined,
  parsedQuery: undefined,
};

describe('WebSourceAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns Exa results when Exa succeeds', async () => {
    (httpPost as any).mockResolvedValue({
      results: [
        { title: 'Exa Result', url: 'https://example.com/1', text: 'content', score: 0.9 },
      ],
    });

    const adapter = new WebSourceAdapter();
    const results = await adapter.search('test query', {
      ...baseOpts,
      exaApiKey: 'exa-key',
      tavilyApiKey: 'tavily-key',
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      source: 'web',
      name: 'Exa Result',
      url: 'https://example.com/1',
    });
    expect(httpPost).toHaveBeenCalledTimes(1);
  });

  it('falls back to Tavily when Exa throws (402 quota exhausted)', async () => {
    (httpPost as any)
      .mockRejectedValueOnce(new Error('402 Payment Required'))
      .mockResolvedValueOnce({
        results: [
          { title: 'Tavily Result', url: 'https://example.com/2', content: 'content', score: 0.8 },
        ],
      });

    const adapter = new WebSourceAdapter();
    const results = await adapter.search('test query', {
      ...baseOpts,
      exaApiKey: 'exa-key',
      tavilyApiKey: 'tavily-key',
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      source: 'web',
      name: 'Tavily Result',
      url: 'https://example.com/2',
    });
    expect(httpPost).toHaveBeenCalledTimes(2); // Exa 失败 + Tavily 成功
  });

  it('returns empty array when both Exa and Tavily fail', async () => {
    (httpPost as any).mockRejectedValue(new Error('network error'));

    const adapter = new WebSourceAdapter();
    const results = await adapter.search('test query', {
      ...baseOpts,
      exaApiKey: 'exa-key',
      tavilyApiKey: 'tavily-key',
    });

    expect(results).toEqual([]);
  });

  it('returns empty array when no API keys configured', async () => {
    const adapter = new WebSourceAdapter();
    const results = await adapter.search('test query', baseOpts);
    expect(results).toEqual([]);
    expect(httpPost).not.toHaveBeenCalled();
  });

  it('uses Tavily directly when no Exa key', async () => {
    (httpPost as any).mockResolvedValue({
      results: [
        { title: 'Tavily Only', url: 'https://example.com/3', content: 'content', score: 0.7 },
      ],
    });

    const adapter = new WebSourceAdapter();
    const results = await adapter.search('test query', {
      ...baseOpts,
      tavilyApiKey: 'tavily-key',
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: 'Tavily Only' });
    expect(httpPost).toHaveBeenCalledTimes(1);
  });

  it('uses expandedQuery from parsedQuery when available', async () => {
    (httpPost as any).mockResolvedValue({ results: [] });

    const adapter = new WebSourceAdapter();
    await adapter.search('中文查询', {
      ...baseOpts,
      exaApiKey: 'exa-key',
      parsedQuery: { expandedQuery: 'chinese query', fuzzyQuery: 'cn query' } as any,
    });

    // httpPost 的第一个参数是 URL,第二个是 options。body 在 options.body 里
    const callArgs = (httpPost as any).mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.query).toBe('chinese query');
  });
});
