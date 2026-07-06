// src/enrich/readmeFetcher.ts
import { httpGet, HttpError } from '../util/http.js';
import { DEFAULT_RETRY } from '../util/retry.js';
import { toSourceError } from '../sources/sourceError.js';

export interface FetchReadmeOpts {
  timeoutMs: number;
  githubToken?: string;
  /** 最大返回行数,默认 30 */
  maxLines?: number;
}

/**
 * 抓取 GitHub 仓库的 README 内容(前 N 行)。
 * 用 GET /repos/{owner}/{repo}/readme + Accept: application/vnd.github.raw 直接拿 Markdown 原文。
 * 404(无 README)返回空字符串,不抛错(增强信息缺失不阻断)。
 * 其他 HTTP 错误抛 SourceError,由上层编排器决定容错。
 */
export async function fetchReadme(
  repo: string, // owner/repo 格式
  opts: FetchReadmeOpts,
): Promise<string> {
  const url = `https://api.github.com/repos/${repo}/readme`;
  try {
    const content = await httpGet<string>(url, {
      timeoutMs: opts.timeoutMs,
      token: opts.githubToken,
      extraHeaders: { 'accept': 'application/vnd.github.raw' },
      text: true,
      retry: DEFAULT_RETRY,
    });
    const maxLines = opts.maxLines ?? 30;
    return content.split('\n').slice(0, maxLines).join('\n');
  } catch (err) {
    // 404 = 仓库无 README,返回空(不报错)
    if (err instanceof HttpError && err.status === 404) return '';
    throw toSourceError('github', err);
  }
}
