// tests/sources/pypiSourceAdapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PypiSourceAdapter, parsePypiHtml, decodeHtml } from '../../src/sources/pypiSourceAdapter.js';

const SAMPLE_HTML = `
<!DOCTYPE html>
<html>
<body>
  <main>
    <div class="search-results">
      <a href="/project/markdown/" class="package-snippet">
        <h3>
          <span class="package-snippet__name">markdown</span>
          <span class="package-snippet__version">3.7</span>
          <span class="package-snippet__released">Sep 25, 2024</span>
        </h3>
        <p class="package-snippet__description">Python implementation of Markdown.</p>
      </a>
      <a href="/project/markdown2/" class="package-snippet">
        <h3>
          <span class="package-snippet__name">markdown2</span>
          <span class="package-snippet__version">2.5</span>
          <span class="package-snippet__released">Jan 1, 2025</span>
        </h3>
        <p class="package-snippet__description">A fast &amp; complete implementation of Markdown.</p>
      </a>
    </div>
  </main>
</body>
</html>
`;

describe('decodeHtml', () => {
  it('decodes common HTML entities', () => {
    expect(decodeHtml('a &amp; b &lt; c &gt; d &quot;e&quot; &#39;f&#39;'))
      .toBe('a & b < c > d "e" \'f\'');
  });
});

describe('parsePypiHtml', () => {
  it('parses package snippets from HTML', () => {
    const results = parsePypiHtml(SAMPLE_HTML);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      source: 'pypi',
      name: 'markdown',
      url: 'https://pypi.org/project/markdown/',
      description: 'Python implementation of Markdown.',
      version: '3.7',
    });
  });

  it('decodes HTML entities in description', () => {
    const results = parsePypiHtml(SAMPLE_HTML);
    expect(results[1].description).toBe('A fast & complete implementation of Markdown.');
  });

  it('returns empty array when no package snippets', () => {
    const html = '<html><body><p>no results</p></body></html>';
    expect(parsePypiHtml(html)).toEqual([]);
  });

  it('handles missing description gracefully', () => {
    const html = `
      <a href="/project/no-desc/" class="package-snippet">
        <h3><span class="package-snippet__name">no-desc</span>
        <span class="package-snippet__version">1.0</span></h3>
      </a>`;
    const results = parsePypiHtml(html);
    expect(results).toHaveLength(1);
    expect(results[0].description).toBe('');
  });
});

describe('PypiSourceAdapter.search', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('fetches pypi.org/search and parses HTML', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => SAMPLE_HTML,
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new PypiSourceAdapter();
    const results = await adapter.search('markdown', { intent: 'project', timeoutMs: 1000 });
    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('markdown');
    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.pathname).toBe('/search/');
    expect(calledUrl.searchParams.get('q')).toBe('markdown');
  });

  it('translates Chinese query to English', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => '',
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new PypiSourceAdapter();
    await adapter.search('图片水印', { intent: 'feature', timeoutMs: 1000 });
    const q = new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('q') ?? '';
    expect(q).toMatch(/image/);
    expect(q).toMatch(/watermark/);
  });

  it('throws SourceError on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 503, headers: new Headers(),
      text: async () => 'service unavailable',
    } as unknown as Response));
    const adapter = new PypiSourceAdapter();
    await expect(adapter.search('x', { intent: 'project', timeoutMs: 1000 }))
      .rejects.toThrow(/pypi/i);
  });

  it('returns empty array when HTML has no results (graceful degradation)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => '<html><body>no packages found</body></html>',
    } as unknown as Response));
    const adapter = new PypiSourceAdapter();
    const results = await adapter.search('nonexistent', { intent: 'project', timeoutMs: 1000 });
    expect(results).toEqual([]);
  });
});
