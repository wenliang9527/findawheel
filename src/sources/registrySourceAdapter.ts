// src/sources/registrySourceAdapter.ts
import type { SourceAdapter, SearchOpts } from './sourceAdapter.js';
import type { NpmRawResult, CratesRawResult, RawResult } from '../normalize/types.js';
import { httpGet } from '../util/http.js';
import { DEFAULT_RETRY } from '../util/retry.js';
import { SourceError } from '../errors.js';
import { translateQuery } from '../classifier/queryTranslator.js';
import { logError } from '../util/logger.js';
import { toSourceError } from './sourceError.js';

interface NpmSearchResponse {
  objects: Array<{
    package: {
      name: string;
      version: string;
      description: string | null;
      links: { npm?: string; repository?: string; homepage?: string };
      keywords?: string[];
      date: string;
    };
  }>;
  total: number;
}

interface NpmDownloadsResponse {
  downloads: number;
}

interface GitHubRepoData {
  stargazers_count: number;
}

interface CratesSearchResponse {
  crates: Array<{
    id: string;
    name: string;
    description: string | null;
    max_version: string;
    downloads: number;
    recent_downloads: number;
    updated_at: string;
    repository: string | null;
  }>;
}

async function searchNpm(query: string, timeoutMs: number): Promise<NpmRawResult[]> {
  const url = new URL('https://registry.npmjs.org/-/v1/search');
  url.searchParams.set('text', query);
  url.searchParams.set('size', '20');
  try {
    const data = await httpGet<NpmSearchResponse>(url.toString(), { timeoutMs, retry: DEFAULT_RETRY });
    return data.objects.map(o => {
      // 从 links.repository 提取 GitHub 仓库地址(如果有)
      const repoUrl = o.package.links.repository;
      let githubUrl: string | undefined;
      if (repoUrl) {
        const ghMatch = repoUrl.match(/github\.com[:/]([^/]+)\/([^/.?#]+)/);
        if (ghMatch) {
          githubUrl = `https://github.com/${ghMatch[1]}/${ghMatch[2]}`;
        }
      }
      return {
        source: 'npm' as const,
        name: o.package.name,
        url: o.package.links.npm ?? `https://www.npmjs.com/package/${o.package.name}`,
        description: o.package.description ?? '',
        version: o.package.version,
        keywords: o.package.keywords ?? [],
        date: o.package.date,
        githubUrl,
      };
    });
  } catch (err) {
    throw toSourceError('npm', err);
  }
}

/**
 * 给 npm 包补充 popularity 指标:
 * 1. downloads — 周下载量(调 npm downloads API,总是做)
 * 2. stars — GitHub stars(仅当包关联了 GitHub 仓库且配置了 token 时做,避免无 token 时 60/hour 限流)
 *
 * 只对前 10 个包做 enrich(控制 API 调用数),其余保持原样。
 */
async function enrichNpmResults(
  results: NpmRawResult[],
  timeoutMs: number,
  githubToken?: string,
): Promise<NpmRawResult[]> {
  const ENRICH_LIMIT = 10;
  const toEnrich = results.slice(0, ENRICH_LIMIT);
  const rest = results.slice(ENRICH_LIMIT);
  const enriched = await Promise.all(
    toEnrich.map(r => enrichSingleNpm(r, timeoutMs, githubToken)),
  );
  return [...enriched, ...rest];
}

async function enrichSingleNpm(
  result: NpmRawResult,
  timeoutMs: number,
  githubToken?: string,
): Promise<NpmRawResult> {
  // 有 GitHub 仓库且有 token:并发补 downloads + stars
  if (result.githubUrl && githubToken) {
    const ownerRepo = result.githubUrl.replace('https://github.com/', '');
    const [dlRes, ghRes] = await Promise.allSettled([
      httpGet<NpmDownloadsResponse>(
        `https://api.npmjs.org/downloads/point/last-week/${result.name}`,
        { timeoutMs, retry: DEFAULT_RETRY },
      ),
      httpGet<GitHubRepoData>(
        `https://api.github.com/repos/${ownerRepo}`,
        { timeoutMs, token: githubToken, extraHeaders: { accept: 'application/vnd.github+json' }, retry: DEFAULT_RETRY },
      ),
    ]);
    // P0-2:rejected 分支记日志,避免 npm 包 stars 缺失时无法定位原因
    if (dlRes.status === 'rejected') {
      logError(`npm downloads enrich failed for ${result.name}`, dlRes.reason);
    }
    if (ghRes.status === 'rejected') {
      logError(`npm github stars enrich failed for ${result.name} (${ownerRepo})`, ghRes.reason);
    }
    return {
      ...result,
      downloads: dlRes.status === 'fulfilled' ? dlRes.value.downloads : undefined,
      stars: ghRes.status === 'fulfilled' ? ghRes.value.stargazers_count : undefined,
    };
  }
  // 无 GitHub 仓库或无 token:只补 downloads
  try {
    const dl = await httpGet<NpmDownloadsResponse>(
      `https://api.npmjs.org/downloads/point/last-week/${result.name}`,
      { timeoutMs, retry: DEFAULT_RETRY },
    );
    return { ...result, downloads: dl.downloads };
  } catch (err) {
    logError('npm enrich failed', err);
    return result; // 补充失败也不影响搜索结果
  }
}

async function searchCrates(query: string, timeoutMs: number): Promise<CratesRawResult[]> {
  const url = new URL('https://crates.io/api/v1/crates');
  url.searchParams.set('q', query);
  url.searchParams.set('per_page', '20');
  try {
    const data = await httpGet<CratesSearchResponse>(url.toString(), {
      timeoutMs,
      userAgent: 'findawheel/0.1 (https://github.com/findawheel)',
      retry: DEFAULT_RETRY,
    });
    return data.crates.map(c => ({
      source: 'crates' as const,
      name: c.name,
      url: `https://crates.io/crates/${c.name}`,
      description: c.description ?? '',
      version: c.max_version,
      downloads: c.downloads,
      recentDownloads: c.recent_downloads,
      updatedAt: c.updated_at,
      license: null, // crates search endpoint doesn't return license
    }));
  } catch (err) {
    throw toSourceError('crates', err);
  }
}

export class RegistrySourceAdapter implements SourceAdapter {
  readonly name = 'registry';

  async search(query: string, opts: SearchOpts): Promise<RawResult[]> {
    const eco = opts.ecosystem;
    // PyPI has no search API — skip, GitHub adapter covers Python via mirror repos
    if (eco === 'python') return [];
    // npm/crates 不支持 NOT/引号语法,用展开后的 query(含中文翻译)
    // 反义词过滤交给 Ranker 后处理
    const expandedQuery = opts.parsedQuery?.expandedQuery ?? translateQuery(query);
    const tasks: Promise<RawResult[]>[] = [];
    if (!eco || eco === 'js' || eco === 'ts') {
      tasks.push(
        searchNpm(expandedQuery, opts.timeoutMs)
          .then(r => enrichNpmResults(r, opts.timeoutMs, opts.githubToken))
          .then(r => r as RawResult[]),
      );
    }
    if (!eco || eco === 'rust') {
      tasks.push(searchCrates(expandedQuery, opts.timeoutMs).then(r => r as RawResult[]));
    }
    const settled = await Promise.allSettled(tasks);
    const ok: RawResult[] = [];
    const errors: SourceError[] = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') ok.push(...r.value);
      else if (r.reason instanceof SourceError) errors.push(r.reason);
      else errors.push(new SourceError('registry', String(r.reason)));
    }
    // Re-throw only if ALL sub-sources failed AND there were tasks
    if (ok.length === 0 && errors.length > 0 && tasks.length === errors.length) {
      throw errors[0];
    }
    return ok;
  }
}
