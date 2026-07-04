// src/sources/gitlabSourceAdapter.ts
import type { SourceAdapter, SearchOpts } from './sourceAdapter.js';
import type { GitlabRawResult, RawResult } from '../normalize/types.js';
import { httpGet, HttpError } from '../util/http.js';
import { DEFAULT_RETRY } from '../util/retry.js';
import { RateLimitError, SourceError } from '../errors.js';
import { translateQuery } from '../classifier/queryTranslator.js';

/** GitLab /api/v4/projects 返回的项目对象 */
interface GitlabProject {
  id: number;
  description: string | null;
  name: string;
  /** 完整路径,如 "group/subgroup/repo" */
  path_with_namespace: string;
  web_url: string;
  star_count: number;
  /** 最近活动时间(对应 GitHub pushedAt) */
  last_activity_at: string;
  topics?: string[];
  archived: boolean;
}

/**
 * GitLab 数据源适配器。
 * 用 /api/v4/projects?search=<q>&order_by=star_count 搜索公开项目。
 * 不需要 token(匿名可搜),可选 GITLAB_TOKEN 提升限流额度。
 * GitLab 不支持 NOT/引号语法,直接用翻译后的 query。
 */
export class GitlabSourceAdapter implements SourceAdapter {
  readonly name = 'gitlab';

  async search(query: string, opts: SearchOpts): Promise<RawResult[]> {
    // GitLab 不支持 NOT/引号语法,用翻译后的 query(含中文→英文转换)直接搜
    const q = translateQuery(query);
    const url = new URL('https://gitlab.com/api/v4/projects');
    url.searchParams.set('search', q);
    url.searchParams.set('order_by', 'star_count');
    url.searchParams.set('sort', 'desc');
    url.searchParams.set('per_page', '50');

    // GitLab PAT 用 PRIVATE-TOKEN header(非 Authorization: Bearer)
    const extraHeaders: Record<string, string> = { 'accept': 'application/json' };
    if (opts.gitlabToken) extraHeaders['private-token'] = opts.gitlabToken;

    try {
      // GitLab /projects 返回数组(非 GitHub 的 { items } 对象包裹)
      const data = await httpGet<GitlabProject[]>(url.toString(), {
        timeoutMs: opts.timeoutMs,
        extraHeaders,
        retry: DEFAULT_RETRY,
      });
      return data.map((item): GitlabRawResult => ({
        source: 'gitlab',
        name: item.path_with_namespace,
        url: item.web_url,
        description: item.description ?? '',
        stars: item.star_count,
        lastActivityAt: item.last_activity_at,
        topics: item.topics ?? [],
        archived: item.archived,
      }));
    } catch (err) {
      if (err instanceof HttpError && err.status === 429) {
        throw new RateLimitError('gitlab', new Date());
      }
      if (err instanceof HttpError) throw new SourceError('gitlab', `HTTP ${err.status}`);
      throw new SourceError('gitlab', (err as Error).message);
    }
  }
}
