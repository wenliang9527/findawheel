// src/sources/githubSourceAdapter.ts
import type { SourceAdapter, SearchOpts } from './sourceAdapter.js';
import type { GitHubRawResult, RawResult } from '../normalize/types.js';
import { httpGet, HttpError } from '../util/http.js';
import { RateLimitError, SourceError } from '../errors.js';
import { translateQuery } from '../classifier/queryTranslator.js';
import type { ParsedQuery } from '../classifier/queryParser.js';

const ECOSYSTEM_LANG: Record<string, string> = {
  js: 'JavaScript', ts: 'TypeScript',
  python: 'Python', rust: 'Rust', go: 'Go', java: 'Java',
};

// 排除聚合类仓库(awesome-xxx、public-apis 等),它们不是具体工具
const AGGREGATE_NAME_PATTERNS = ['awesome', 'public-apis', 'free-for-dev', 'awesome-list'];

/**
 * 构造 GitHub 搜索表达式。
 * 优化:
 * 1. 核心短语用引号包裹,强制短语匹配(避免多词被 OR 拆开)
 * 2. 反义词用 NOT 排除(如搜"加水印"时排除"remove watermark")
 * 3. 排除聚合仓库(awesome-xxx)
 */
export function buildGithubQuery(
  query: string,
  intent: 'feature' | 'project',
  ecosystem?: string,
  parsed?: ParsedQuery,
): string {
  // 1. 确定搜索关键词:优先用 parsedQuery 的核心短语 + 修饰词
  let searchTerms: string;
  if (parsed && parsed.corePhrase) {
    // 核心短语用引号包裹强制命中,修饰词作为可选
    const quotedCore = parsed.corePhrase.includes(' ')
      ? `"${parsed.corePhrase}"`
      : parsed.corePhrase;
    searchTerms = [quotedCore, ...parsed.modifiers].join(' ');
  } else {
    // 兜底:无 parsedQuery 时用翻译后的完整 query
    searchTerms = translateQuery(query);
  }

  // 2. 搜索范围:feature 级加 readme(更细粒度),project 级只看 name+description
  const inClause = intent === 'feature'
    ? 'in:name,description,readme'
    : 'in:name,description';

  const parts: string[] = [`${searchTerms} ${inClause}`, 'sort:stars'];

  // 3. 排除聚合仓库(GitHub NOT 语法)
  parts.push('NOT awesome in:name');

  // 4. 排除反义词(如搜 watermark 时 NOT remove NOT clean NOT strip)
  if (parsed && parsed.antonymExcludes.length > 0) {
    // GitHub NOT 语法:NOT <word> in:description
    // 限制最多 3 个,避免查询过长
    for (const w of parsed.antonymExcludes.slice(0, 3)) {
      parts.push(`NOT ${w} in:description`);
    }
  }

  if (ecosystem && ECOSYSTEM_LANG[ecosystem]) {
    parts.push(`language:${ECOSYSTEM_LANG[ecosystem]}`);
  }
  return parts.join(' ');
}

/**
 * 判断是否为聚合类仓库(awesome-xxx、public-apis 等)。
 * 用于 Ranker 后过滤,补充 GitHub 搜索 NOT 语法覆盖不到的情况。
 */
export function isAggregateRepo(name: string, description: string): boolean {
  const text = `${name} ${description}`.toLowerCase();
  return AGGREGATE_NAME_PATTERNS.some(p => text.includes(p));
}

interface GitHubSearchResponse {
  total_count: number;
  items: Array<{
    full_name: string;
    html_url: string;
    description: string | null;
    stargazers_count: number;
    language: string | null;
    license: { spdx_id: string | null } | null;
    archived: boolean;
    pushed_at: string;
    topics?: string[];
  }>;
}

export class GitHubSourceAdapter implements SourceAdapter {
  readonly name = 'github';

  async search(query: string, opts: SearchOpts): Promise<RawResult[]> {
    const q = buildGithubQuery(query, opts.intent, opts.ecosystem, opts.parsedQuery);
    const url = new URL('https://api.github.com/search/repositories');
    url.searchParams.set('q', q);
    url.searchParams.set('sort', 'stars');
    url.searchParams.set('order', 'desc');
    url.searchParams.set('per_page', '50');

    try {
      const data = await httpGet<GitHubSearchResponse>(url.toString(), {
        timeoutMs: opts.timeoutMs,
        token: opts.githubToken,
        extraHeaders: { 'accept': 'application/vnd.github+json' },
      });
      return data.items.map((item): GitHubRawResult => ({
        source: 'github',
        name: item.full_name,
        url: item.html_url,
        description: item.description ?? '',
        stars: item.stargazers_count,
        language: item.language,
        license: item.license?.spdx_id ?? null,
        archived: item.archived,
        pushedAt: item.pushed_at,
        topics: item.topics ?? [],
      }));
    } catch (err) {
      if (err instanceof HttpError && err.status === 403) throw new RateLimitError('github', new Date());
      if (err instanceof HttpError) throw new SourceError('github', `HTTP ${err.status}`);
      throw new SourceError('github', (err as Error).message);
    }
  }
}
