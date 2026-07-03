// src/classifier/queryParser.ts
// 把自然语言 query 拆分成:核心短语 + 修饰词 + 反义词排除。
// 用于让数据源做更精准的搜索(GitHub 支持引号短语 + NOT 语法),
// 以及让 Ranker 过滤掉"反向意图"的结果(如用户想"加水印"却搜到"移除水印")。

import { translateQuery } from './queryTranslator.js';

export interface ParsedQuery {
  /** 核心短语(前 2-3 个实义词),用于引号包裹强制命中 */
  corePhrase: string;
  /** 修饰词(剩余的实义词),作为可选命中加分 */
  modifiers: string[];
  /** 反义词排除列表,传给搜索源 NOT 语法 + Ranker 后过滤 */
  antonymExcludes: string[];
  /** 展开后的完整 query(含中文翻译),用于传给不支持复杂语法的源 */
  expandedQuery: string;
}

/**
 * 反义词表:当 query 含某动作词且用户意图是"做这个动作"时,
 * 排除 description 里含"反向动作"的结果。
 * 例:用户搜 watermark(想加水印),排除 remove watermark / watermark remover
 */
const ANTONYMS: Record<string, string[]> = {
  watermark: ['remove', 'clean', 'strip', 'delete', 'erase'],
  encrypt: ['decrypt', 'crack', 'break'],
  // 如果用户搜"解析 parser",排除"反解析"意义不大,这里只列真正易混淆的
};

/** 通用停用词/填充词,不作为核心短语的一部分 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'for', 'with', 'and', 'or', 'to', 'of', 'in', 'on',
  'my', 'i', 'want', 'need', 'looking', 'find', 'search',
  'image', 'tool', 'library', 'lib', 'package', 'pkg', 'project', // 通用词,不当核心
]);

/**
 * 解析 query,拆分核心词/修饰词并检测反义词。
 *
 * @example
 * parseQuery('invisible image watermark encryption resistant cropping')
 * // {
 * //   corePhrase: 'invisible watermark',
 * //   modifiers: ['encryption', 'resistant', 'cropping'],
 * //   antonymExcludes: ['remove', 'clean', 'strip', 'delete', 'erase'],
 * //   expandedQuery: 'invisible image watermark encryption resistant cropping'
 * // }
 */
export function parseQuery(query: string): ParsedQuery {
  // 1. 先翻译中文,中英合并
  const expandedQuery = translateQuery(query);

  // 2. 拆词,过滤停用词和短词
  const allWords = expandedQuery
    .toLowerCase()
    .split(/[\s,，。、;；!！?？]+/)
    .filter(w => w.length > 1 && !STOPWORDS.has(w));

  // 3. 核心短语 = 前 2 个实义词(引号包裹时至少 2 个词才有意义)
  const coreWords = allWords.slice(0, 2);
  const modifierWords = allWords.slice(2);
  const corePhrase = coreWords.join(' ');

  // 4. 反义词检测:query 含动作词但不含"反向动作"时,推断用户意图是"做这个动作"
  const antonymExcludes: string[] = [];
  const lowerQuery = query.toLowerCase();
  for (const [action, excludeWords] of Object.entries(ANTONYMS)) {
    // query 含该动作词
    if (!lowerQuery.includes(action)) continue;
    // 但 query 本身不是"反向动作"(如 "remove watermark" 不会触发排除)
    const isReverseIntent = excludeWords.some(w => lowerQuery.includes(w));
    if (!isReverseIntent) {
      antonymExcludes.push(...excludeWords);
    }
  }

  return { corePhrase, modifiers: modifierWords, antonymExcludes, expandedQuery };
}
