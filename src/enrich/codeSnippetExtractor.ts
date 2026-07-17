// src/enrich/codeSnippetExtractor.ts
import type { CodeSnippet } from '../normalize/types.js';

// CodeSnippet 已下沉到 normalize/types.ts(消除 normalize 反向依赖)。re-export 保持向后兼容。
export type { CodeSnippet } from '../normalize/types.js';

export interface ExtractOpts {
  /** 最多提取几个代码块，默认 2 */
  maxCount?: number;
  /** 每个代码块最大字符数，默认 200 */
  maxCharsPerSnippet?: number;
}

// P2-3:支持 GFM ~~~ 围栏(与 ``` 等价)。结束围栏用 (?:```|~~~) 而非反向引用,
// 简化版(实际混用 ``` 开头 ~~~ 结尾的场景罕见,不额外处理)。
const FENCE_RE = /(?:```|~~~)(\w*)\n([\s\S]*?)(?:```|~~~)/g;

function priority(language: string): number {
  switch (language.toLowerCase()) {
    case 'bash':
    case 'shell':
    case 'sh':
      return 0;
    case 'js':
    case 'javascript':
    case 'ts':
    case 'typescript':
    case 'python':
    case 'py':
      return 1;
    default:
      return 2;
  }
}

/**
 * 从 README Markdown 文本中提取代码块（``` 围栏）。
 * 优先级：bash/shell（安装示例）> js/javascript/ts/typescript/python（使用示例）> 其他。
 * 跳过空代码块。无代码块返回空数组。
 */
export function extractCodeSnippets(readme: string, opts?: ExtractOpts): CodeSnippet[] {
  const maxCount = opts?.maxCount ?? 2;
  const maxCharsPerSnippet = opts?.maxCharsPerSnippet ?? 200;

  const snippets: CodeSnippet[] = [];
  const matches: Array<{ snippet: CodeSnippet; index: number }> = [];
  let index = 0;

  for (const m of readme.matchAll(FENCE_RE)) {
    const language = m[1] || 'text';
    const raw = m[2] ?? '';
    const code = raw.trim();
    if (code === '') continue;
    matches.push({
      snippet: { language, code },
      index: index++,
    });
  }

  // 稳定排序：按优先级升序，同优先级保留出现顺序
  matches.sort((a, b) => {
    const pa = priority(a.snippet.language);
    const pb = priority(b.snippet.language);
    if (pa !== pb) return pa - pb;
    return a.index - b.index;
  });

  for (const { snippet } of matches) {
    if (snippets.length >= maxCount) break;
    const code =
      snippet.code.length > maxCharsPerSnippet
        ? snippet.code.slice(0, maxCharsPerSnippet) + '...'
        : snippet.code;
    snippets.push({ language: snippet.language, code });
  }

  return snippets;
}
