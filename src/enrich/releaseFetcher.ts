// src/enrich/releaseFetcher.ts
import { httpGet, HttpError } from '../util/http.js';
import { DEFAULT_RETRY } from '../util/retry.js';
import { SourceError } from '../errors.js';

export interface FetchReleaseOpts {
  timeoutMs: number;
  githubToken?: string;
}

export interface LatestRelease {
  /** release tag，如 "v4.18.0" */
  tag: string;
  /** 发布时间 ISO 字符串 */
  publishedAt: string;
  /** release 标题（可选） */
  name?: string;
}

interface GitHubRelease {
  tag_name: string;
  published_at: string;
  name: string | null;
}

/**
 * 抓取 GitHub 仓库的最新 release。
 * 用 GET /repos/{owner}/{repo}/releases/latest。
 * 404（仓库无 release）返回 null，不抛错。
 * 其他 HTTP 错误抛 SourceError，由上层编排器决定容错。
 */
export async function fetchLatestRelease(
  repo: string, // owner/repo 格式
  opts: FetchReleaseOpts,
): Promise<LatestRelease | null> {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  try {
    const raw = await httpGet<GitHubRelease>(url, {
      timeoutMs: opts.timeoutMs,
      token: opts.githubToken,
      extraHeaders: { accept: 'application/vnd.github+json' },
      retry: DEFAULT_RETRY,
    });
    const release: LatestRelease = {
      tag: raw.tag_name,
      publishedAt: raw.published_at,
    };
    if (raw.name) release.name = raw.name;
    return release;
  } catch (err) {
    // 404 = 仓库无 release，返回 null（不报错）
    if (err instanceof HttpError && err.status === 404) return null;
    if (err instanceof HttpError) throw new SourceError('github', `release HTTP ${err.status}`);
    throw new SourceError('github', (err as Error).message);
  }
}
