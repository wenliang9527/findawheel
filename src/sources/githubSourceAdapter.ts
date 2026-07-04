// src/sources/githubSourceAdapter.ts
import type { SourceAdapter, SearchOpts } from './sourceAdapter.js';
import type { GitHubRawResult, RawResult } from '../normalize/types.js';
import { httpGet, HttpError } from '../util/http.js';
import { DEFAULT_RETRY } from '../util/retry.js';
import { RateLimitError, SourceError } from '../errors.js';
import { translateQuery } from '../classifier/queryTranslator.js';
import type { ParsedQuery } from '../classifier/queryParser.js';
import { ECOSYSTEM_LANG } from './ecosystemMapping.js';

/**
 * 构造 GitHub 搜索表达式。
 *
 * Phase 6 简化后:
 * - 统一逻辑:单词不加引号,多词加引号(让 GitHub 做短语精确匹配)
 * - 不再有领域特化逻辑(嵌入式不加引号 / 只用第一个词 等都已删除)
 * - 修饰词不进 searchTerms,避免 GitHub AND 命中过严
 * - 反义词 NOT 子句已删除(AI 自己识别反向意图)
 *
 * 修饰词交给 Ranker 后处理时做加分/过滤即可。
 *
 * 注:聚合仓库模式表(awesome-xxx、public-apis 等)已统一移到 ranker.ts 的
 * isAggregateRepo(),由 filterOut 阶段统一剔除。
 */
export function buildGithubQuery(
  query: string,
  intent: 'feature' | 'project',
  ecosystem?: string,
  parsed?: ParsedQuery,
): string {
  // 1. 确定搜索关键词:只用核心短语强制命中,修饰词不进 searchTerms。
  // 之前把修饰词也拼进 searchTerms 会导致 GitHub AND 命中过严,
  // 例如搜 "stepper motor driver microcontroller" 时 driver/microcontroller
  // 都被强制要求命中,把 simplefoc/Arduino-FOC 这种 description 只含
  // "Arduino FOC for BLDC and Stepper motors" 的主流库全过滤掉了。
  // 修饰词交给 Ranker 后处理时做加分/过滤即可。
  let searchTerms: string;
  if (parsed && parsed.corePhrase) {
    if (!parsed.corePhrase.includes(' ')) {
      // 单词不加引号
      searchTerms = parsed.corePhrase;
    } else {
      // 多词:用引号短语精确匹配
      searchTerms = `"${parsed.corePhrase}"`;
    }
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

  if (ecosystem && ECOSYSTEM_LANG[ecosystem]) {
    parts.push(`language:${ECOSYSTEM_LANG[ecosystem]}`);
  }
  return parts.join(' ');
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
        retry: DEFAULT_RETRY,
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
