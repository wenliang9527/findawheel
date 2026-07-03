// src/sources/githubSourceAdapter.ts
import type { SourceAdapter, SearchOpts } from './sourceAdapter.js';
import type { GitHubRawResult, RawResult } from '../normalize/types.js';
import { httpGet, HttpError } from '../util/http.js';
import { RateLimitError, SourceError } from '../errors.js';

const ECOSYSTEM_LANG: Record<string, string> = {
  js: 'JavaScript', ts: 'TypeScript',
  python: 'Python', rust: 'Rust', go: 'Go', java: 'Java',
};

export function buildGithubQuery(
  query: string,
  intent: 'feature' | 'project',
  ecosystem?: string,
): string {
  const inClause = intent === 'feature'
    ? 'in:name,description,readme'
    : 'in:name,description';
  const parts = [`${query} ${inClause}`, 'sort:stars'];
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
    const q = buildGithubQuery(query, opts.intent, opts.ecosystem);
    const url = new URL('https://api.github.com/search/repositories');
    url.searchParams.set('q', q);
    url.searchParams.set('sort', 'stars');
    url.searchParams.set('order', 'desc');
    url.searchParams.set('per_page', '20');

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
