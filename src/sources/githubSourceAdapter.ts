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
  cpp: 'C++', arduino: 'Arduino',
  // 注:'c' 故意不映射 —— 单片机 C 项目在 GitHub 上常被标记为 C/C++/Arduino,
  // 限制成单一语言会漏掉主流库(如 simplefoc/Arduino-FOC 是 C++)。
  // 用户想精确搜时可用 ecosystem=cpp 或 ecosystem=arduino。
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
  // 1. 确定搜索关键词:只用核心短语强制命中,修饰词不进 searchTerms。
  // 之前把修饰词也拼进 searchTerms 会导致 GitHub AND 命中过严,
  // 例如搜 "stepper motor driver microcontroller" 时 driver/microcontroller
  // 都被强制要求命中,把 simplefoc/Arduino-FOC 这种 description 只含
  // "Arduino FOC for BLDC and Stepper motors" 的主流库全过滤掉了。
  // 修饰词交给 Ranker 后处理时做加分/过滤即可。
  let searchTerms: string;
  if (parsed && parsed.corePhrase) {
    const isEmbeddedDomain = parsed.domain === 'embedded';
    if (isEmbeddedDomain) {
      // 嵌入式领域只用 corePhrase 的第一个词作为 searchTerms:
      // 1. 不加引号:让 GitHub 做词干匹配(如 motor → motors)
      // 2. 只用第一个词:避免多词 AND 搜索过滤掉主流库
      //    例:corePhrase="serial uart" 时,只搜 "serial",node-serialport
      //    (description="Node.js package to access serial ports") 才能被命中;
      //    若搜 "serial uart" AND,node-serialport 不含 uart 会被过滤。
      //    Ranker 后处理用 coreWords 做精确过滤,保证相关性。
      const firstWord = parsed.corePhrase.split(' ')[0];
      searchTerms = firstWord;
    } else if (!parsed.corePhrase.includes(' ')) {
      // 单词不加引号
      searchTerms = parsed.corePhrase;
    } else {
      // 非嵌入式多词:用引号短语精确匹配
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

  // 4. 排除反义词(如搜 watermark 时 NOT remove NOT clean NOT strip)
  if (parsed && parsed.antonymExcludes.length > 0) {
    // GitHub NOT 语法:NOT <word> in:description
    // 限制最多 3 个,避免查询过长
    for (const w of parsed.antonymExcludes.slice(0, 3)) {
      parts.push(`NOT ${w} in:description`);
    }
  }

  if (ecosystem && ECOSYSTEM_LANG[ecosystem]) {
    // 嵌入式领域不加 language 限制:嵌入式库语言混杂(C/C++/Arduino/Python/JS/TS),
    // 限制成单一语言会漏掉主流库。
    // 例:node-serialport(8.5k stars)是 JavaScript,但用户可能传 ecosystem=ts;
    //     Serial-Studio(3k stars)是 C++,用户可能传 ecosystem=cpp。
    // 与 ECOSYSTEM_LANG 表里 'c' 不映射的设计理念一致。
    const isEmbeddedDomain = parsed?.domain === 'embedded';
    if (!isEmbeddedDomain) {
      parts.push(`language:${ECOSYSTEM_LANG[ecosystem]}`);
    }
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
