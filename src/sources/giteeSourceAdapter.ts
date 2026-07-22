// src/sources/giteeSourceAdapter.ts
// Gitee 搜索源适配器。
// API 文档: https://gitee.com/api/v5/swagger#/getV5SearchRepositories
// 限流:认证 5000/hour,未认证 60/hour
// 鉴权:可选 GITEE_TOKEN,通过 access_token query 参数注入(Gitee API v5 标准做法)
// 注意:Gitee 不支持 NOT/引号语法,用 expandedQuery(含中文翻译)兜底

import type { SourceAdapter, SearchOpts } from './sourceAdapter.js';
import type { GiteeRawResult, RawResult } from '../normalize/types.js';
import { httpGet } from '../util/http.js';
import { DEFAULT_RETRY } from '../util/retry.js';
import { translateQuery } from '../classifier/queryTranslator.js';
import { ECOSYSTEM_LANG } from './ecosystemMapping.js';
import { toSourceError } from '../util/sourceError.js';

interface GiteeSearchResponse {
  total_count?: number;
  items: Array<{
    full_name: string;       // "owner/repo"
    human_name: string;      // 人类可读名
    html_url: string;
    description: string | null;
    stargazers_count: number;
    language: string | null;
    license: { name: string } | null;
    updated_at: string;
    project_creator?: string;
  }>;
}

export class GiteeSourceAdapter implements SourceAdapter {
  readonly name = 'gitee';

  async search(query: string, opts: SearchOpts): Promise<RawResult[]> {
    // Gitee 不支持复杂语法,用 expandedQuery(含中文翻译)
    const q = opts.parsedQuery?.expandedQuery ?? translateQuery(query);

    const url = new URL('https://gitee.com/api/v5/search/repositories');
    url.searchParams.set('q', q);
    // Gitee API v5 合法值是 stars_count(实测 sort=stars 返回 400)
    url.searchParams.set('sort', 'stars_count');
    url.searchParams.set('order', 'desc');
    url.searchParams.set('per_page', '20');

    // 可选鉴权:带 token 提升限流到 5000/hour(匿名 60/hour)
    if (opts.giteeToken) {
      url.searchParams.set('access_token', opts.giteeToken);
    }

    // 按生态系统过滤语言
    if (opts.ecosystem && ECOSYSTEM_LANG[opts.ecosystem]) {
      url.searchParams.set('language', ECOSYSTEM_LANG[opts.ecosystem]);
    }

    try {
      const data = await httpGet<GiteeSearchResponse>(url.toString(), {
        timeoutMs: opts.timeoutMs,
        retry: DEFAULT_RETRY,
      });
      return (data.items ?? []).map((item): GiteeRawResult => ({
        source: 'gitee',
        name: item.full_name,
        url: item.html_url,
        description: item.description ?? '',
        stars: item.stargazers_count,
        language: item.language,
        license: item.license?.name ?? null,
        updatedAt: item.updated_at,
        humanName: item.human_name,
      }));
    } catch (err) {
      throw toSourceError('gitee', err);
    }
  }
}
