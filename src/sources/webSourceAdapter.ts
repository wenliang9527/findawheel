// src/sources/webSourceAdapter.ts
// Web 搜索源适配器(Tavily)。
// API 文档: https://docs.tavily.com/docs/rest-api/api-reference
// 端点: POST https://api.tavily.com/search
// 需要 API key,无 key 时本 adapter 直接返回空数组(不报错,降级处理)
//
// 价值:能搜到 GitHub/npm/crates 之外的资源(教程、博客、工具站),
// 扩大召回面,尤其适合查"有没有现成工具做 X"这种意图。

import type { SourceAdapter, SearchOpts } from './sourceAdapter.js';
import type { WebRawResult, RawResult } from '../normalize/types.js';
import { translateQuery } from '../classifier/queryTranslator.js';
import { SourceError } from '../errors.js';

interface TavilySearchResponse {
  results: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
    raw_content?: string;
  }>;
  answer?: string;
}

export class WebSourceAdapter implements SourceAdapter {
  readonly name = 'web';

  async search(query: string, opts: SearchOpts): Promise<RawResult[]> {
    // 无 API key 时降级:返回空数组,不报错(避免拖累整体搜索)
    if (!opts.tavilyApiKey) {
      return [];
    }

    // 用 expandedQuery(含中文翻译),Tavily 不支持复杂语法
    const q = opts.parsedQuery?.expandedQuery ?? translateQuery(query);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: opts.tavilyApiKey,
          query: q,
          search_depth: 'basic',
          max_results: 10,
          // 偏向工具/项目页面,排除纯新闻
          include_domains: ['github.com', 'npmjs.com', 'crates.io', 'pypi.org'],
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new SourceError('web', `HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as TavilySearchResponse;
      return (data.results ?? []).map((item): WebRawResult => ({
        source: 'web',
        name: item.title,
        url: item.url,
        description: item.content.slice(0, 300), // 截断,避免 description 过长
        score: item.score,
      }));
    } catch (err) {
      // Web 搜索失败不影响主搜索,返回空数组
      if (err instanceof SourceError) return [];
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}
