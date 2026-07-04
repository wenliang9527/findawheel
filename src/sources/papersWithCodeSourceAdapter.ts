// src/sources/papersWithCodeSourceAdapter.ts
// Papers with Code 适配器 —— 补「算法/论文」盲区。
//
// 关键差异(对比其他源):
// 1. 无需 key(公开 API)
// 2. GET 请求,可用 httpGet
// 3. API 文档质量较差(老旧),结构可能不稳定,代码做防御性解析
// 4. 论文没有 stars 概念,但有关联 repo 可以查 stars(本期暂不抓,留空)
// 5. 返回论文标题/摘要/年份,以及 arxiv 链接
//
// 端点: GET https://paperswithcode.com/api/v1/papers/?q={query}&page=1&items_per_page=20

import type { SourceAdapter, SearchOpts } from './sourceAdapter.js';
import type { PaperRawResult, RawResult } from '../normalize/types.js';
import { httpGet, HttpError } from '../util/http.js';
import { DEFAULT_RETRY } from '../util/retry.js';
import { SourceError } from '../errors.js';

const API_BASE = 'https://paperswithcode.com/api/v1';
const DEFAULT_PAGE_SIZE = 20;

interface PwcPaper {
  id: string;
  url_abs?: string;       // arxiv 链接
  url_pdf?: string;
  title: string;
  abstract?: string;
  published?: string;     // YYYY-MM-DD 或 YYYY
  authors?: string[];
  proceeding?: string | null;
}

interface PwcSearchResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: PwcPaper[];
}

/**
 * 把 published 字段(可能是 "2017-06-12" 或 "2017")统一成 year 数字
 */
function extractYear(published?: string): number | undefined {
  if (!published) return undefined;
  const match = published.match(/^(\d{4})/);
  return match ? parseInt(match[1], 10) : undefined;
}

export class PapersWithCodeSourceAdapter implements SourceAdapter {
  readonly name = 'paperswithcode';

  async search(query: string, opts: SearchOpts): Promise<RawResult[]> {
    const url = new URL(`${API_BASE}/papers/`);
    url.searchParams.set('q', query);
    url.searchParams.set('page', '1');
    url.searchParams.set('items_per_page', String(DEFAULT_PAGE_SIZE));

    try {
      const data = await httpGet<PwcSearchResponse>(url.toString(), {
        timeoutMs: opts.timeoutMs,
        retry: DEFAULT_RETRY,
      });
      return (data.results ?? []).map((p): PaperRawResult => ({
        source: 'paperswithcode',
        name: p.title,
        // 详情页 URL:paperswithcode.com/paper/{id}
        url: `https://paperswithcode.com/paper/${p.id}`,
        description: p.abstract ?? '',
        year: extractYear(p.published),
        // arxiv 链接作为 repoUrl 占位(便于用户进一步查看)
        repoUrl: p.url_abs,
      }));
    } catch (err) {
      if (err instanceof HttpError) throw new SourceError('paperswithcode', `HTTP ${err.status}`);
      throw new SourceError('paperswithcode', (err as Error).message);
    }
  }
}
