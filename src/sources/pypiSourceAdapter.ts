// src/sources/pypiSourceAdapter.ts
import type { SourceAdapter, SearchOpts } from './sourceAdapter.js';
import type { PypiRawResult, RawResult } from '../normalize/types.js';
import { httpGet, HttpError } from '../util/http.js';
import { SourceError } from '../errors.js';
import { translateQuery } from '../classifier/queryTranslator.js';

/** 解码常见 HTML 实体(避免引入完整 HTML 解析依赖) */
export function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * 解析 PyPI 搜索页 HTML,提取包信息。
 * PyPI 用 package-snippet 结构:
 *   <a href="/project/name/" class="package-snippet">
 *     <h3><span class="package-snippet__name">name</span>
 *         <span class="package-snippet__version">1.0</span> ...</h3>
 *     <p class="package-snippet__description">desc</p>
 *   </a>
 *
 * 正则解析脆弱,HTML 结构变更时会返回空数组(容错,不抛错)。
 */
export function parsePypiHtml(html: string): PypiRawResult[] {
  const results: PypiRawResult[] = [];
  // 匹配每个 package-snippet <a> 块(非贪婪到 </a>)
  const snippetRegex = /<a[^>]*class="package-snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const nameRegex = /package-snippet__name[^>]*>([^<]+)</;
  const versionRegex = /package-snippet__version[^>]*>([^<]+)</;
  const descRegex = /package-snippet__description[^>]*>([^<]*)</;
  const hrefRegex = /href="([^"]+)"/;

  let match: RegExpExecArray | null;
  while ((match = snippetRegex.exec(html)) !== null) {
    const block = match[1]; // <a> 标签内部内容
    const nameMatch = block.match(nameRegex);
    const versionMatch = block.match(versionRegex);
    const descMatch = block.match(descRegex);
    // href 在外层 <a> 标签上,需要从完整 match[0] 提取
    const hrefMatch = match[0].match(hrefRegex);
    if (nameMatch && hrefMatch) {
      const name = nameMatch[1].trim();
      const href = hrefMatch[1].trim();
      const url = href.startsWith('http') ? href : `https://pypi.org${href}`;
      const description = descMatch ? decodeHtml(descMatch[1].trim()) : '';
      const version = versionMatch ? versionMatch[1].trim() : '';
      results.push({ source: 'pypi', name, url, description, version });
    }
  }
  return results;
}

/**
 * PyPI 数据源适配器。
 * PyPI 没有官方搜索 JSON API,通过解析 https://pypi.org/search/?q=<q> 的 HTML 提取包信息。
 * 无 stars/downloads 数据(PyPI 不提供)。
 * 解析失败返回空数组,不抛错(HTML 结构可能变更)。
 */
export class PypiSourceAdapter implements SourceAdapter {
  readonly name = 'pypi';

  async search(query: string, opts: SearchOpts): Promise<RawResult[]> {
    const q = translateQuery(query);
    const url = new URL('https://pypi.org/search/');
    url.searchParams.set('q', q);

    try {
      const html = await httpGet<string>(url.toString(), {
        timeoutMs: opts.timeoutMs,
        extraHeaders: { 'accept': 'text/html' },
        text: true,
      });
      return parsePypiHtml(html);
    } catch (err) {
      // 网络错误/HTTP 错误仍需上报(但 HTML 解析失败已在 parsePypiHtml 内容错返回空)
      if (err instanceof HttpError) throw new SourceError('pypi', `HTTP ${err.status}`);
      throw new SourceError('pypi', (err as Error).message);
    }
  }
}
