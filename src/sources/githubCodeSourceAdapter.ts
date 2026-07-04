// src/sources/githubCodeSourceAdapter.ts
// GitHub Code Search API 适配器 —— 补「代码片段」盲区。
//
// 关键差异(对比 githubSourceAdapter):
// 1. 调用 /search/code 而非 /search/repositories
// 2. 限流更严格:10 req/min(认证后),且强制要求认证(无 token 直接失败)
// 3. 结果是「文件级」而非「仓库级」,RawResult 包含文件路径和命中片段
// 4. 只搜默认分支、<384KB 文件;必须有至少一个搜索词
// 5. text_matches 需要主动请求(application/vnd.github.text-match+json)

import type { SourceAdapter, SearchOpts } from './sourceAdapter.js';
import type { GitHubCodeRawResult, RawResult } from '../normalize/types.js';
import { httpGet, HttpError } from '../util/http.js';
import { RateLimitError, SourceError } from '../errors.js';

const ECOSYSTEM_LANG: Record<string, string> = {
  js: 'JavaScript', ts: 'TypeScript',
  python: 'Python', rust: 'Rust', go: 'Go', java: 'Java',
};

/**
 * 构造 GitHub Code Search 查询表达式。
 *
 * 与 repository search 不同:
 * - 用 `in:file` 而非 `in:name,description`
 * - 必须有至少一个搜索词(language:go 单独不行,要 amazing language:go)
 * - 用 text-match media type 才能拿到代码片段
 *
 * 例:`addClass in:file language:js repo:jquery/jquery`
 */
export function buildGithubCodeQuery(
  query: string,
  ecosystem?: string,
): string {
  // Code Search 不支持复杂的 in: 语法组合,直接用 query 关键词
  const parts: string[] = [query];

  if (ecosystem && ECOSYSTEM_LANG[ecosystem]) {
    parts.push(`language:${ECOSYSTEM_LANG[ecosystem]}`);
  }
  return parts.join(' ');
}

interface GitHubCodeSearchItem {
  name: string;          // 文件名(如 parser.ts)
  path: string;          // 完整路径(如 src/utils/parser.ts)
  sha: string;
  url: string;           // API url
  html_url: string;      // 浏览器 url
  repository: {
    full_name: string;   // owner/repo
    description: string | null;
    stargazers_count: number;
    language: string | null;
    pushed_at: string;
  };
  score: number;
  text_matches?: Array<{
    object_url: string;
    property: string;
    fragment: string;
    matches: Array<{ text: string; indices: [number, number] }>;
  }>;
}

interface GitHubCodeSearchResponse {
  total_count: number;
  items: GitHubCodeSearchItem[];
  incomplete_results?: boolean;
}

export class GitHubCodeSourceAdapter implements SourceAdapter {
  readonly name = 'github-code';

  async search(query: string, opts: SearchOpts): Promise<RawResult[]> {
    // Code Search 强制要求认证,无 token 直接跳过(返回空,不抛错,避免阻断主搜索)
    if (!opts.githubToken) {
      return [];
    }

    const q = buildGithubCodeQuery(query, opts.ecosystem);
    const url = new URL('https://api.github.com/search/code');
    url.searchParams.set('q', q);
    url.searchParams.set('sort', 'indexed');
    url.searchParams.set('order', 'desc');
    // Code Search per_page 上限 100,这里保守用 20 控制流量(限流 10 req/min)
    url.searchParams.set('per_page', '20');

    try {
      const data = await httpGet<GitHubCodeSearchResponse>(url.toString(), {
        timeoutMs: opts.timeoutMs,
        token: opts.githubToken,
        // text-match media type 让 GitHub 返回代码片段
        extraHeaders: { 'accept': 'application/vnd.github.text-match+json' },
      });
      return data.items.map((item): GitHubCodeRawResult => ({
        source: 'github-code',
        name: item.repository.full_name,
        url: item.html_url,
        path: item.path,
        description: item.repository.description ?? '',
        stars: item.repository.stargazers_count,
        language: item.repository.language,
        // 取第一个 text_matches 的 fragment 作为命中片段
        textFragment: item.text_matches?.[0]?.fragment?.trim() || undefined,
        pushedAt: item.repository.pushed_at,
      }));
    } catch (err) {
      if (err instanceof HttpError && err.status === 403) throw new RateLimitError('github-code', new Date());
      if (err instanceof HttpError) throw new SourceError('github-code', `HTTP ${err.status}`);
      throw new SourceError('github-code', (err as Error).message);
    }
  }
}
