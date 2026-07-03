// src/sources/sourceAdapter.ts
import type { RawResult } from '../normalize/types.js';

export interface SourceAdapter {
  readonly name: string;
  search(query: string, opts: SearchOpts): Promise<RawResult[]>;
}

export interface SearchOpts {
  intent: 'feature' | 'project';
  ecosystem?: string;
  timeoutMs: number;
  githubToken?: string;
}
