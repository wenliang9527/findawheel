// tests/sources/webSourceAdapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock httpPost before importing the adapter
vi.mock('../../src/util/http.js', () => ({
  httpPost: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(
      public status: number,
      public url: string,
      body: string,
      public headers?: Record<string, string>,
    ) {
      super(`HTTP ${status} from ${url}: ${body.slice(0, 200)}`);
      this.name = 'HttpError';
    }
    get retryable(): boolean {
      return this.status >= 500;
    }
  },
}));

import { httpPost } from '../../src/util/http.js';
import { WebSourceAdapter } from '../../src/sources/webSourceAdapter.js';
import { SourceError } from '../../src/errors.js';
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
    vi.mocked(httpPost).mockResolvedValue({
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
    vi.mocked(httpPost)
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

  it('throws SourceError when both Exa and Tavily fail', async () => {
    vi.mocked(httpPost).mockRejectedValue(new Error('network error'));

    const adapter = new WebSourceAdapter();
    const opts = { ...baseOpts, exaApiKey: 'exa-key', tavilyApiKey: 'tavily-key' };
    // 两个子源都失败时抛 SourceError,使 findWheelTool 能标记 web 源为 degraded
    await expect(adapter.search('test query', opts)).rejects.toBeInstanceOf(SourceError);
    // source name 应为 'web'(toSourceError('web', err) 生成 [web] ... 格式 message)
    await expect(adapter.search('test query', opts)).rejects.toThrow(/\[web\]/);
  });

  it('returns empty array when no API keys configured', async () => {
    const adapter = new WebSourceAdapter();
    const results = await adapter.search('test query', baseOpts);
    expect(results).toEqual([]);
    expect(httpPost).not.toHaveBeenCalled();
  });

  it('uses Tavily directly when no Exa key', async () => {
    vi.mocked(httpPost).mockResolvedValue({
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
    vi.mocked(httpPost).mockResolvedValue({ results: [] });

    const adapter = new WebSourceAdapter();
    await adapter.search('中文查询', {
      ...baseOpts,
      exaApiKey: 'exa-key',
      parsedQuery: { expandedQuery: 'chinese query', fuzzyQuery: 'cn query' } as any,
    });

    // httpPost 的第一个参数是 URL,第二个是 options。body 在 options.body 里
    const callArgs = vi.mocked(httpPost).mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.query).toBe('chinese query');
  });
});
