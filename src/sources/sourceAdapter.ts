// src/sources/sourceAdapter.ts
import type { RawResult } from '../normalize/types.js';
import type { ParsedQuery } from '../classifier/queryParser.js';

export interface SourceAdapter {
  readonly name: string;
  search(query: string, opts: SearchOpts): Promise<RawResult[]>;
}

export interface SearchOpts {
  intent: 'feature' | 'project';
  ecosystem?: string;
  timeoutMs: number;
  githubToken?: string;
  /** GitLab token(可选,提升限流额度) */
  gitlabToken?: string;
  /** Gitee token(可选,提升限流额度:匿名 60/hour,认证 5000/hour) */
  giteeToken?: string;
  /** Libraries.io API key(必需,未配置时 adapter 跳过) */
  librariesIoApiKey?: string;
  /** Exa API key(Web 搜索主源),可选 */
  exaApiKey?: string;
  /** Tavily API key(Web 搜索兜底源),可选 */
  tavilyApiKey?: string;
  /** 解析后的 query(核心短语/修饰词/反义词),adapter 可据此优化搜索语法 */
  parsedQuery?: ParsedQuery;
}
