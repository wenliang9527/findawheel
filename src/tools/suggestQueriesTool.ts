// src/tools/suggestQueriesTool.ts
// suggest_queries 工具:接收用户原始 query,返回多个搜索词变体。
// 目的:让 AI 在调 find_wheel 前,先看到结构化的搜索词建议,选择最合适的。
//
// findawheel 是 MCP Server,不能调 LLM,所以这里用 queryParser 的规则版
// 生成多角度搜索词(精准/动作导向/模糊/简洁)。

import { parseQuery } from '../classifier/queryParser.js';
import { translateQuery } from '../classifier/queryTranslator.js';
import { classify } from '../classifier/queryClassifier.js';
import type { Intent } from '../normalize/types.js';
import type { McpToolResult } from './types.js';

export interface SuggestQueriesInput {
  /** 用户原始 query(中英文皆可) */
  query: string;
  ecosystem?: string;
}

export interface QuerySuggestion {
  /** 搜索词角度标签 */
  angle: 'precise' | 'action_oriented' | 'fuzzy' | 'concise';
  /** 角度的中文说明 */
  description: string;
  /** 建议的英文搜索词 */
  query: string;
  /** 推荐使用场景 */
  when_to_use: string;
}

export interface SuggestQueriesOutput {
  /** 用户原始 query */
  originalQuery: string;
  /** 翻译后的英文 query(供参考) */
  translatedQuery: string;
  /** 推断的意图 */
  intent: Intent;
  /** 多角度搜索词建议 */
  suggestions: QuerySuggestion[];
  /** 推荐的首选搜索词 */
  recommended: string;
  /** 推荐理由 */
  reason: string;
}

export function createSuggestQueriesTool() {
  async function handle(input: SuggestQueriesInput): Promise<McpToolResult> {
    if (!input.query || input.query.trim() === '') {
      return {
        content: [{ type: 'text', text: 'query is required' }],
        isError: true,
      };
    }

    const parsed = parseQuery(input.query);
    const intent = classify(input.query, 'auto');
    const translated = translateQuery(input.query);

    // 生成 4 个角度的搜索词
    const suggestions: QuerySuggestion[] = [
      {
        angle: 'precise',
        description: '精准搜索(核心短语 + 修饰词)',
        query: [parsed.corePhrase, ...parsed.modifiers].join(' ').trim() || translated,
        when_to_use: '当需要精确匹配时使用,适合 GitHub 引号搜索',
      },
      {
        angle: 'action_oriented',
        description: '动作导向(动词 + 格式词)',
        query: [...parsed.coreWords, ...parsed.formatWords].join(' ').trim() || translated,
        when_to_use: '当用户意图明确是"做某事"时使用,动词优先',
      },
      {
        angle: 'fuzzy',
        description: '模糊搜索(同义词泛化)',
        query: parsed.fuzzyQuery,
        when_to_use: '当精准搜索召回不足时使用,扩大召回范围',
      },
      {
        angle: 'concise',
        description: '简洁搜索(仅核心词)',
        query: parsed.coreWords.join(' ') || parsed.corePhrase,
        when_to_use: '当 query 过长可能影响搜索时使用',
      },
    ];

    // 推荐:动作导向通常最精准(动词表达意图)
    const recommended = suggestions[1].query;
    const reason = `动作导向搜索词"${recommended}"优先使用了动词(${parsed.coreWords.join('/')}),最能表达用户意图,推荐作为 find_wheel 的 query 参数`;

    const output: SuggestQueriesOutput = {
      originalQuery: input.query,
      translatedQuery: translated,
      intent,
      suggestions,
      recommended,
      reason,
    };

    return { content: [{ type: 'text', text: JSON.stringify(output) }] };
  }

  return { handle };
}
