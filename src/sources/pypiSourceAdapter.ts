// src/sources/pypiSourceAdapter.ts
import type { SourceAdapter, SearchOpts } from './sourceAdapter.js';
import type { PypiRawResult, RawResult } from '../normalize/types.js';
import { httpGet } from '../util/http.js';
import { DEFAULT_RETRY } from '../util/retry.js';
import { translateQuery } from '../classifier/queryTranslator.js';
import { toSourceError } from './sourceError.js';
import { logError } from '../util/logger.js';

/** 解码常见 HTML 实体(避免引入完整 HTML 解析依赖) */
export function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * 解析 PyPI 搜索页 HTML,提取包信息。
 * PyPI 用 package-snippet 结构:
 *   <a href="/project/name/" class="package-snippet">
 *     <h3><span class="package-snippet__name">name</span>
 *         <span class="package-snippet__version">1.0</span> ...</h3>
 *     <p class="package-snippet__description">desc</p>
 *   </a>
 *
 * 正则解析脆弱,HTML 结构变更时会返回空数组(容错,不抛错)。
 */
export function parsePypiHtml(html: string): PypiRawResult[] {
  const results: PypiRawResult[] = [];
  // 匹配每个 package-snippet <a> 块(非贪婪到 </a>)
  const snippetRegex = /<a[^>]*class="package-snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const nameRegex = /package-snippet__name[^>]*>([^<]+)</;
  const versionRegex = /package-snippet__version[^>]*>([^<]+)</;
  const descRegex = /package-snippet__description[^>]*>([^<]*)</;
  const hrefRegex = /href="([^"]+)"/;

  let match: RegExpExecArray | null;
  while ((match = snippetRegex.exec(html)) !== null) {
    const block = match[1]; // <a> 标签内部内容
    const nameMatch = block.match(nameRegex);
    const versionMatch = block.match(versionRegex);
    const descMatch = block.match(descRegex);
    // href 在外层 <a> 标签上,需要从完整 match[0] 提取
    const hrefMatch = match[0].match(hrefRegex);
    if (nameMatch && hrefMatch) {
      const name = nameMatch[1].trim();
      const href = hrefMatch[1].trim();
      const url = href.startsWith('http') ? href : `https://pypi.org${href}`;
      const description = descMatch ? decodeHtml(descMatch[1].trim()) : '';
      const version = versionMatch ? versionMatch[1].trim() : '';
      results.push({ source: 'pypi', name, url, description, version });
    }
  }
  return results;
}

/** PyPI JSON API 响应(pypi.org/pypi/<name>/json) */
interface PypiJsonResponse {
  info: {
    home_page: string | null;
    project_urls: Record<string, string> | null;
    name: string;
  };
}

/** GitHub repo 数据(用于补 stars) */
interface GitHubRepoData {
  stargazers_count: number;
}

/**
 * 从 PyPI JSON API 的 home_page / project_urls 中提取 GitHub 仓库 URL。
 * 匹配 github.com/owner/repo 格式。
 */
function extractGithubUrl(data: PypiJsonResponse): string | undefined {
  const candidates: string[] = [];
  if (data.info.home_page) candidates.push(data.info.home_page);
  if (data.info.project_urls) {
    // project_urls 是 { "Homepage": "...", "Source": "...", ... } 格式
    for (const v of Object.values(data.info.project_urls)) {
      if (v) candidates.push(v);
    }
  }
  for (const url of candidates) {
    const match = url.match(/github\.com[:/]([^/]+)\/([^/.?#]+)/);
    if (match) {
      return `https://github.com/${match[1]}/${match[2]}`;
    }
  }
  return undefined;
}

/**
 * 给 PyPI 包补充 popularity 指标(stars)。
 * 流程:查 pypi.org/pypi/<name>/json 取 home_page → 若指向 GitHub 则查 GitHub API 取 stars。
 * 只对前 10 个包做 enrich(控制 API 调用数),其余保持原样。
 * 需配置 githubToken 才做 GitHub stars 查询(避免无 token 时 60/hour 限流)。
 */
async function enrichPypiResults(
  results: PypiRawResult[],
  timeoutMs: number,
  githubToken?: string,
): Promise<PypiRawResult[]> {
  // 无 token 时跳过 enrich(GitHub API 无 token 限流 60/hour,PyPI 搜索可能返回 20 个包)
  if (!githubToken) return results;

  const ENRICH_LIMIT = 10;
  const toEnrich = results.slice(0, ENRICH_LIMIT);
  const rest = results.slice(ENRICH_LIMIT);
  const enriched = await Promise.all(
    toEnrich.map(r => enrichSinglePypi(r, timeoutMs, githubToken)),
  );
  return [...enriched, ...rest];
}

async function enrichSinglePypi(
  result: PypiRawResult,
  timeoutMs: number,
  githubToken: string,
): Promise<PypiRawResult> {
  try {
    // 1. 查 PyPI JSON API 获取 home_page
    const pyData = await httpGet<PypiJsonResponse>(
      `https://pypi.org/pypi/${result.name}/json`,
      { timeoutMs, retry: DEFAULT_RETRY },
    );
    const githubUrl = extractGithubUrl(pyData);
    if (!githubUrl) return result; // 非 GitHub 项目,跳过

    // 2. 查 GitHub API 获取 stars
    const ownerRepo = githubUrl.replace('https://github.com/', '');
    try {
      const ghData = await httpGet<GitHubRepoData>(
        `https://api.github.com/repos/${ownerRepo}`,
        { timeoutMs, token: githubToken, extraHeaders: { accept: 'application/vnd.github+json' }, retry: DEFAULT_RETRY },
      );
      return { ...result, stars: ghData.stargazers_count, githubUrl };
    } catch (err) {
      logError(`pypi github stars enrich failed for ${result.name} (${ownerRepo})`, err);
      return { ...result, githubUrl }; // 仍保留 githubUrl,即使 stars 获取失败
    }
  } catch (err) {
    logError(`pypi enrich failed for ${result.name}`, err);
    return result; // enrich 失败不影响搜索结果
  }
}

/**
 * PyPI 数据源适配器。
 * PyPI 没有官方搜索 JSON API,通过解析 https://pypi.org/search/?q=<q> 的 HTML 提取包信息。
 * 搜索后对 top 10 做 enrich:查 PyPI JSON API 获取 home_page,若指向 GitHub 则补 stars。
 * 需配置 githubToken 才做 enrich(避免无 token 时 GitHub API 60/hour 限流)。
 * 解析失败返回空数组,不抛错(HTML 结构可能变更)。
 */
export class PypiSourceAdapter implements SourceAdapter {
  readonly name = 'pypi';

  async search(query: string, opts: SearchOpts): Promise<RawResult[]> {
    const q = translateQuery(query);
    const url = new URL('https://pypi.org/search/');
    url.searchParams.set('q', q);

    try {
      const html = await httpGet<string>(url.toString(), {
        timeoutMs: opts.timeoutMs,
        extraHeaders: { 'accept': 'text/html' },
        text: true,
        retry: DEFAULT_RETRY,
      });
      const results = parsePypiHtml(html);
      // O4:对 top 10 补充 GitHub stars(需 githubToken)
      return await enrichPypiResults(results, opts.timeoutMs, opts.githubToken);
    } catch (err) {
      // 网络错误/HTTP 错误仍需上报(但 HTML 解析失败已在 parsePypiHtml 内容错返回空)
      throw toSourceError('pypi', err);
    }
  }
}
