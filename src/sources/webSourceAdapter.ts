// src/sources/webSourceAdapter.ts
// Web 搜索源适配器:Exa 主 + Tavily 兜底。
//
// 策略:
// 1. 优先用 Exa(神经网络搜索,对代码/技术语义更准)
// 2. Exa 失败(额度耗尽 402 / 限流 429 / 网络错误 / 无 key)时 fallback 到 Tavily
// 3. 两个都失败:抛 SourceError(由 findWheelTool 捕获并标记 web 源为 degraded)
//
// P1-4:统一走 httpPost(共享超时/重试/错误处理),获得 5xx 重试能力。
//
// Exa API: https://docs.exa.ai/reference/search
//   POST https://api.exa.ai/search
//   header: x-api-key
//   优势:神经网络搜索,用 embeddings 找语义相似内容,适合"找轮子"场景
//
// Tavily API: https://docs.tavily.com/docs/rest-api/api-reference
//   POST https://api.tavily.com/search
//   body: api_key
//   优势:专为 AI 优化,带 score

import type { SourceAdapter, SearchOpts } from './sourceAdapter.js';
import type { WebRawResult, RawResult } from '../normalize/types.js';
import { translateQuery } from '../classifier/queryTranslator.js';
import { httpPost } from '../util/http.js';
import { DEFAULT_RETRY } from '../util/retry.js';
import { logError } from '../util/logger.js';
import { toSourceError } from './sourceError.js';

interface ExaSearchResponse {
  results: Array<{
    title: string;
    url: string;
    text?: string;
    highlights?: string[];
    score?: number;
  }>;
}

interface TavilySearchResponse {
  results: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
  }>;
}

/**
 * 调 Exa 搜索。
 * Exa 用神经网络搜索,对代码/技术语义更准,适合"找轮子"。
 * 不需要 include_domains,默认就偏向代码内容。
 * P1-4:走 httpPost,共享超时/重试逻辑(5xx 自动重试)。
 */
async function searchExa(
  query: string,
  apiKey: string,
  timeoutMs: number,
): Promise<WebRawResult[]> {
  const body = JSON.stringify({
    query,
    numResults: 10,
    contents: {
      text: true,
      highlights: true,
    },
  });
  const data = await httpPost<ExaSearchResponse>('https://api.exa.ai/search', {
    timeoutMs,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body,
    retry: DEFAULT_RETRY,
  });
  return (data.results ?? []).map((item): WebRawResult => ({
    source: 'web',
    name: item.title,
    url: item.url,
    // 优先用 highlights(更精炼),其次 text
    description: (item.highlights?.join(' ') || item.text || '').slice(0, 300),
    score: item.score,
  }));
}

/**
 * 调 Tavily 搜索(兜底)。
 * 限定 include_domains 偏向工具/项目页面。
 * P1-4:走 httpPost,共享超时/重试逻辑(5xx 自动重试)。
 */
async function searchTavily(
  query: string,
  apiKey: string,
  timeoutMs: number,
): Promise<WebRawResult[]> {
  const body = JSON.stringify({
    api_key: apiKey,
    query,
    search_depth: 'basic',
    max_results: 10,
    include_domains: ['github.com', 'npmjs.com', 'crates.io', 'pypi.org'],
  });
  const data = await httpPost<TavilySearchResponse>('https://api.tavily.com/search', {
    timeoutMs,
    headers: { 'Content-Type': 'application/json' },
    body,
    retry: DEFAULT_RETRY,
  });
  return (data.results ?? []).map((item): WebRawResult => ({
    source: 'web',
    name: item.title,
    url: item.url,
    description: item.content.slice(0, 300),
    score: item.score,
  }));
}

export class WebSourceAdapter implements SourceAdapter {
  readonly name = 'web';

  async search(query: string, opts: SearchOpts): Promise<RawResult[]> {
    // 用 expandedQuery(含中文翻译),两个 API 都不支持复杂语法
    const q = opts.parsedQuery?.expandedQuery ?? translateQuery(query);

    // 跟踪 Exa 是否失败,用于判断"两个子源都失败"(此时需抛 SourceError 让上层标记 degraded)
    let exaFailed = false;

    // 策略 1:优先 Exa(如果有 key)
    if (opts.exaApiKey) {
      try {
        return await searchExa(q, opts.exaApiKey, opts.timeoutMs);
      } catch (err) {
        // Exa 失败,继续尝试 Tavily
        // Exa 与 Tavily 是独立服务的独立 key,任一失败都应尝试另一个:
        // - 402/429:Exa 额度耗尽或限流,Tavily 可能有额度
        // - 401/403:Exa key 无效,Tavily key 仍可能有效(独立账号)
        // - 5xx/网络:服务端故障或网络抖动,Tavily 可能仍可用
        // 4xx 非额度问题不在此提前 return,继续走 Tavily fallback
        exaFailed = true;
        logError('exa search failed, falling back to tavily', err);
      }
    }

    // 策略 2:fallback 到 Tavily(如果有 key)
    if (opts.tavilyApiKey) {
      try {
        return await searchTavily(q, opts.tavilyApiKey, opts.timeoutMs);
      } catch (err) {
        logError('tavily fallback failed', err);
        // 两个子源都失败:抛 SourceError,让 findWheelTool 捕获并标记 web 源为 degraded,
        // 使 AI 能感知 web 源不可用(与其他 13 个适配器失败时 throw toSourceError 一致)。
        // 仅当 Exa 也失败时才抛(保留单源容错:Exa 无 key 时 Tavily 失败不算"两个都失败")。
        if (exaFailed) {
          throw toSourceError('web', err);
        }
        return [];
      }
    }

    // 两个都没配 key:返回空数组(配置缺失不是源故障,不应标记 degraded)
    return [];
  }
}
