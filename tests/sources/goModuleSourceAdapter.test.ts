// tests/sources/goModuleSourceAdapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoModuleSourceAdapter, parseGoHtml } from '../../src/sources/goModuleSourceAdapter.js';
import type { SearchOpts } from '../../src/sources/sourceAdapter.js';

// mock httpGet,同时提供 mock HttpError 类(与 mavenSourceAdapter.test.ts 同款模式)。
// 关键:sourceError.js 也会 import 这个 mock HttpError,保证 instanceof 判定一致。
vi.mock('../../src/util/http.js', () => ({
  httpGet: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, public url: string, body: string) {
      super(`HTTP ${status}`);
    }
    get retryable(): boolean { return this.status >= 500; }
  },
}));

import { httpGet, HttpError } from '../../src/util/http.js';

const baseOpts: SearchOpts = { intent: 'project', timeoutMs: 1000 };

const SAMPLE_HTML = `
<!DOCTYPE html>
<html>
<body>
  <main>
    <div class="SearchResults">
      <div class="SearchSnippet">
        <a href="/github.com/gin-gonic/gin" data-test-id="snippet-title">
          <h2>github.com/gin-gonic/gin</h2>
        </a>
        <p class="SearchSnippet-synopsis">Gin is a HTTP web framework written in Go.</p>
        <span data-test-id="latest-version">v1.9.1</span>
        <span data-test-id="version-published">Published: Sep 12, 2023</span>
      </div>
      <div class="SearchSnippet">
        <a href="/github.com/labstack/echo" data-test-id="snippet-title">
          <h2>github.com/labstack/echo</h2>
        </a>
        <p class="SearchSnippet-synopsis">High performance, extensible &amp; minimalist Go web framework.</p>
        <span data-test-id="latest-version">v4.11.1</span>
        <span data-test-id="version-published">Published: Aug 1, 2023</span>
      </div>
    </div>
  </main>
</body>
</html>
`;

describe('parseGoHtml', () => {
  it('parses SearchSnippet blocks from HTML', () => {
    const results = parseGoHtml(SAMPLE_HTML);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      source: 'gopkg',
      name: 'github.com/gin-gonic/gin',
      url: 'https://pkg.go.dev/github.com/gin-gonic/gin',
      description: 'Gin is a HTTP web framework written in Go.',
      version: 'v1.9.1',
      publishedAt: new Date('Sep 12, 2023').toISOString(),
    });
  });

  it('decodes HTML entities in description', () => {
    const results = parseGoHtml(SAMPLE_HTML);
    expect(results[1].description).toBe('High performance, extensible & minimalist Go web framework.');
  });

  it('returns empty array when no SearchSnippet blocks', () => {
    const html = '<html><body><p>no results</p></body></html>';
    expect(parseGoHtml(html)).toEqual([]);
  });

  it('handles missing synopsis gracefully', () => {
    const html = `
      <div class="SearchSnippet">
        <a href="/github.com/foo/bar" data-test-id="snippet-title">
          <h2>github.com/foo/bar</h2>
        </a>
        <span data-test-id="latest-version">v1.0.0</span>
      </div>`;
    const results = parseGoHtml(html);
    expect(results).toHaveLength(1);
    expect(results[0].description).toBe('');
    expect(results[0].publishedAt).toBeUndefined();
  });

  it('handles missing version gracefully', () => {
    const html = `
      <div class="SearchSnippet">
        <a href="/github.com/foo/baz" data-test-id="snippet-title">
          <h2>github.com/foo/baz</h2>
        </a>
        <p class="SearchSnippet-synopsis">Some module.</p>
        <span data-test-id="version-published">Published: Jan 1, 2025</span>
      </div>`;
    const results = parseGoHtml(html);
    expect(results).toHaveLength(1);
    expect(results[0].version).toBe('');
    expect(results[0].publishedAt).toBe(new Date('Jan 1, 2025').toISOString());
  });

  it('returns undefined publishedAt for unparseable date', () => {
    const html = `
      <div class="SearchSnippet">
        <a href="/github.com/foo/qux" data-test-id="snippet-title">
          <h2>github.com/foo/qux</h2>
        </a>
        <p class="SearchSnippet-synopsis">desc</p>
        <span data-test-id="latest-version">v2.0.0</span>
        <span data-test-id="version-published">Published: not-a-date</span>
      </div>`;
    const results = parseGoHtml(html);
    expect(results).toHaveLength(1);
    expect(results[0].publishedAt).toBeUndefined();
  });

  it('falls back to module path when h2 is empty', () => {
    const html = `
      <div class="SearchSnippet">
        <a href="/github.com/foo/empty" data-test-id="snippet-title">
          <h2></h2>
        </a>
        <p class="SearchSnippet-synopsis">desc</p>
      </div>`;
    const results = parseGoHtml(html);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('github.com/foo/empty');
  });
});

describe('GoModuleSourceAdapter.search', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('fetches pkg.go.dev/search and parses HTML', async () => {
    vi.mocked(httpGet).mockResolvedValue(SAMPLE_HTML as never);

    const adapter = new GoModuleSourceAdapter();
    const results = await adapter.search('web framework', baseOpts);

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('github.com/gin-gonic/gin');

    // 校验 URL 构造与请求参数
    expect(vi.mocked(httpGet)).toHaveBeenCalledTimes(1);
    const calledUrl = new URL(vi.mocked(httpGet).mock.calls[0][0] as string);
    expect(calledUrl.hostname).toBe('pkg.go.dev');
    expect(calledUrl.pathname).toBe('/search');
    expect(calledUrl.searchParams.get('q')).toBe('web framework');
    expect(calledUrl.searchParams.get('m')).toBe('package');
  });

  it('throws SourceError on HTTP error', async () => {
    vi.mocked(httpGet).mockRejectedValue(
      new HttpError(503, 'https://pkg.go.dev/search', 'service unavailable'),
    );

    const adapter = new GoModuleSourceAdapter();
    await expect(adapter.search('x', baseOpts)).rejects.toThrow(/gopkg/i);
  });

  it('returns empty array when HTML has no results (graceful degradation)', async () => {
    vi.mocked(httpGet).mockResolvedValue('<html><body>no modules found</body></html>' as never);

    const adapter = new GoModuleSourceAdapter();
    const results = await adapter.search('nonexistent', baseOpts);
    expect(results).toEqual([]);
  });

  it('translates Chinese query to english keywords', async () => {
    vi.mocked(httpGet).mockResolvedValue('' as never);

    const adapter = new GoModuleSourceAdapter();
    await adapter.search('图片水印', { intent: 'feature', timeoutMs: 1000 });

    const calledUrl = new URL(vi.mocked(httpGet).mock.calls[0][0] as string);
    const q = calledUrl.searchParams.get('q') ?? '';
    expect(q).toMatch(/image/);
    expect(q).toMatch(/watermark/);
  });
});
