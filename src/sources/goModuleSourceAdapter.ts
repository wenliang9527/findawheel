// src/sources/goModuleSourceAdapter.ts
import type { SourceAdapter, SearchOpts } from './sourceAdapter.js';
import type { GoModuleRawResult, RawResult } from '../normalize/types.js';
import { httpGet } from '../util/http.js';
import { DEFAULT_RETRY } from '../util/retry.js';
import { translateQuery } from '../classifier/queryTranslator.js';
import { toSourceError } from './sourceError.js';
import { decodeHtml } from './pypiSourceAdapter.js';

/**
 * 解析 pkg.go.dev 搜索页 HTML,提取 Go 模块信息。
 * pkg.go.dev 用 SearchSnippet 结构:
 *   <div class="SearchSnippet">
 *     <a href="/github.com/gin-gonic/gin" data-test-id="snippet-title">
 *       <h2>github.com/gin-gonic/gin</h2>
 *     </a>
 *     <p class="SearchSnippet-synopsis">Gin is a HTTP web framework...</p>
 *     <span data-test-id="latest-version">v1.9.1</span>
 *     <span data-test-id="version-published">Published: Sep 12, 2023</span>
 *   </div>
 *
 * 正则解析脆弱(无官方 JSON API),HTML 结构变更时会返回空数组(容错,不抛错)。
 * 日期解析失败也用 undefined,不抛错。
 */
export function parseGoHtml(html: string): GoModuleRawResult[] {
  const results: GoModuleRawResult[] = [];
  // 匹配每个 SearchSnippet <div> 块。
  // 非贪婪 [\s\S]*? 到第一个 </div>:依赖 SearchSnippet 内部无嵌套 <div>(synopsis 是 <p>,版本是 <span>)。
  // 若 pkg.go.dev 改版引入嵌套 div,此处需调整;当前结构变更时返回空数组(容错,不抛错)。
  const snippetRegex = /<div[^>]*class="SearchSnippet"[^>]*>([\s\S]*?)<\/div>/g;
  const hrefRegex = /href="([^"]+)"/;
  // <h2> 或 <a> 内容提取 name(优先 <h2>)
  const h2Regex = /<h2[^>]*>([\s\S]*?)<\/h2>/;
  const synopsisRegex = /SearchSnippet-synopsis[^>]*>([\s\S]*?)<\/p>/;
  const versionRegex = /data-test-id="latest-version"[^>]*>([^<]*)</;
  const publishedRegex = /data-test-id="version-published"[^>]*>([^<]*)</;

  let match: RegExpExecArray | null;
  while ((match = snippetRegex.exec(html)) !== null) {
    const block = match[1];
    // href 在外层 <a> 上,需要从完整 match[0] 提取
    const hrefMatch = match[0].match(hrefRegex);
    const h2Match = block.match(h2Regex);
    const synopsisMatch = block.match(synopsisRegex);
    const versionMatch = block.match(versionRegex);
    const publishedMatch = block.match(publishedRegex);

    if (hrefMatch) {
      const href = hrefMatch[1].trim();
      // href 形如 "/github.com/gin-gonic/gin",去掉前导 / 得到模块路径
      const modulePath = href.replace(/^\//, '');
      // name 优先用 <h2> 文本,否则用 modulePath
      const name = h2Match
        ? decodeHtml(h2Match[1].replace(/<[^>]*>/g, '').trim()) || modulePath
        : modulePath;
      const url = href.startsWith('http') ? href : `https://pkg.go.dev${href}`;
      const description = synopsisMatch
        ? decodeHtml(synopsisMatch[1].replace(/<[^>]*>/g, '').trim())
        : '';
      const version = versionMatch ? versionMatch[1].trim() : '';
      // 解析 "Published: Sep 12, 2023" 为 ISO date;失败用 undefined
      let publishedAt: string | undefined;
      if (publishedMatch) {
        const raw = publishedMatch[1].trim();
        // 去掉 "Published: " 前缀(容错,有时直接是日期)
        const dateStr = raw.replace(/^Published:\s*/i, '');
        const d = new Date(dateStr);
        publishedAt = isNaN(d.getTime()) ? undefined : d.toISOString();
      }
      results.push({ source: 'gopkg', name, url, description, version, publishedAt });
    }
  }
  return results;
}

/**
 * Go 模块(pkg.go.dev)数据源适配器。
 * pkg.go.dev 没有官方搜索 JSON API,通过解析 https://pkg.go.dev/search?q=<q>&m=package 的 HTML 提取模块信息。
 * 无 stars/downloads 数据(pkg.go.dev 不提供)。
 * 解析失败返回空数组,不抛错(HTML 结构可能变更)。
 */
export class GoModuleSourceAdapter implements SourceAdapter {
  readonly name = 'gopkg';

  async search(query: string, opts: SearchOpts): Promise<RawResult[]> {
    const q = translateQuery(query);
    const url = new URL('https://pkg.go.dev/search');
    url.searchParams.set('q', q);
    url.searchParams.set('m', 'package');

    try {
      const html = await httpGet<string>(url.toString(), {
        timeoutMs: opts.timeoutMs,
        extraHeaders: { accept: 'text/html' },
        text: true,
        retry: DEFAULT_RETRY,
      });
      return parseGoHtml(html);
    } catch (err) {
      // 网络错误/HTTP 错误仍需上报(但 HTML 解析失败已在 parseGoHtml 内容错返回空)
      throw toSourceError('gopkg', err);
    }
  }
}
