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
  /** Tavily API key(用于 Web 搜索源),可选 */
  tavilyApiKey?: string;
  /** 解析后的 query(核心短语/修饰词/反义词),adapter 可据此优化搜索语法 */
  parsedQuery?: ParsedQuery;
}
