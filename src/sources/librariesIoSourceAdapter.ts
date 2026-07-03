// src/sources/librariesIoSourceAdapter.ts
import type { SourceAdapter, SearchOpts } from './sourceAdapter.js';
import type { LibrariesIoRawResult, RawResult } from '../normalize/types.js';
import { httpGet, HttpError } from '../util/http.js';
import { SourceError } from '../errors.js';
import { translateQuery } from '../classifier/queryTranslator.js';

/** Libraries.io /api/search 返回的项目对象 */
interface LibrariesIoProject {
  name: string;
  platform: string;
  description: string | null;
  homepage: string | null;
  repository_url: string | null;
  language: string | null;
  stars: number | null;
  latest_release_published_at: string | null;
}

/**
 * Libraries.io 数据源适配器。
 * 用 GET https://libraries.io/api/search?q=<q>&api_key=<key> 搜索,
 * 一次查询覆盖 30+ 包管理器(npm/pypi/rubygems/cargo/maven...)。
 * 需要 LIBRARIES_IO_API_KEY,未配置时返回空数组跳过该源(零配置兼容)。
 */
export class LibrariesIoSourceAdapter implements SourceAdapter {
  readonly name = 'librariesio';

  async search(query: string, opts: SearchOpts): Promise<RawResult[]> {
    // 无 API key 时跳过(零配置兼容:不调 fetch,直接返回空)
    if (!opts.librariesIoApiKey) return [];

    const q = translateQuery(query);
    const url = new URL('https://libraries.io/api/search');
    url.searchParams.set('q', q);
    url.searchParams.set('api_key', opts.librariesIoApiKey);

    try {
      const data = await httpGet<LibrariesIoProject[]>(url.toString(), {
        timeoutMs: opts.timeoutMs,
      });
      return data.map((item): LibrariesIoRawResult => ({
        source: 'librariesio',
        name: item.name,
        // URL fallback:homepage → repository_url → libraries.io 页面
        url: item.homepage
          ?? item.repository_url
          ?? `https://libraries.io/${item.platform}/${item.name}`,
        description: item.description ?? '',
        stars: item.stars ?? 0,
        language: item.language,
        platform: item.platform,
        // null 保留(测试期望 toBeNull),normalizer 分支按需转 undefined
        lastUpdated: item.latest_release_published_at,
      }));
    } catch (err) {
      if (err instanceof HttpError) throw new SourceError('librariesio', `HTTP ${err.status}`);
      throw new SourceError('librariesio', (err as Error).message);
    }
  }
}
