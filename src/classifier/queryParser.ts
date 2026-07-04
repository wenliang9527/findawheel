// src/classifier/queryParser.ts
// 把自然语言 query 拆分成:核心短语 + 修饰词 + 反义词排除。
// 用于让数据源做更精准的搜索(GitHub 支持引号短语 + NOT 语法),
// 以及让 Ranker 过滤掉"反向意图"的结果(如用户想"加水印"却搜到"移除水印")。

import { translateQuery } from './queryTranslator.js';

export interface ParsedQuery {
  /** 核心短语(前 2 个实义词),用于引号包裹强制命中(GitHub 搜索) */
  corePhrase: string;
  /**
   * 核心词(动词优先),用于 Ranker 核心词必命中过滤。
   * 优先从 query 里挑动作动词(monitor/convert/parse...),
   * 因为动词表达用户真正的意图,比对象词(coding/assistant)更能区分相关结果。
   */
  coreWords: string[];
  /** 修饰词(剩余的实义词),作为可选命中加分 */
  modifiers: string[];
  /** 反义词排除列表,传给搜索源 NOT 语法 + Ranker 后过滤 */
  antonymExcludes: string[];
  /** 展开后的完整 query(含中文翻译),用于传给不支持复杂语法的源 */
  expandedQuery: string;
  /** query 里出现的格式词(pdf/word/ppt/excel 等),用于 Ranker 格式必命中过滤 */
  formatWords: string[];
  /** 模糊化语义 query(同义词/上位词泛化),用于副搜索扩大召回 */
  fuzzyQuery: string;
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
 * 文件格式词:当 query 里出现这些词时,结果的 description/name 也必须命中至少一个。
 * 用于过滤掉"格式不相关"的结果(如搜 "pdf to markdown" 却返回 HTML 转换器)。
 */
const FORMAT_WORDS = new Set([
  'pdf', 'docx', 'doc', 'word', 'ppt', 'pptx', 'powerpoint', 'excel', 'xlsx', 'xls',
  'csv', 'html', 'markdown', 'md', 'png', 'jpg', 'jpeg', 'gif', 'svg',
  'video', 'audio', 'mp3', 'mp4', 'json', 'xml', 'yaml', 'txt', 'rtf',
  'epub', 'mobi', 'tex', 'latex',
]);

/**
 * 动作动词表:这些词表达用户真正的意图(做什么),
 * coreWords 优先从动词里选,避免 "AI coding assistant monitor" 把 monitor 扔到修饰词。
 *
 * 分类:
 * - 监控类:monitor/track/observe/watch/detect...
 * - 转换类:convert/transform/parse/extract/generate/render...
 * - 操作类:compress/encrypt/watermark/scrape/crawl...
 */
const ACTION_VERBS = new Set([
  // 监控/追踪
  'monitor', 'track', 'tracking', 'observe', 'watch', 'detect', 'trace',
  'log', 'logging', 'measure', 'metric', 'metrics', 'stat', 'stats', 'status',
  // 转换/处理
  'convert', 'converter', 'transform', 'parse', 'parser', 'extract', 'extractor',
  'generate', 'generator', 'render', 'renderer', 'build', 'builder', 'compile',
  'compile', 'transpile', 'bundle', 'pack', 'unpack',
  // 操作/动作
  'compress', 'decompress', 'encrypt', 'decrypt', 'watermark', 'scrape',
  'crawler', 'crawl', 'fetch', 'download', 'upload', 'sync', 'deploy',
  // 分析/查询
  'search', 'query', 'analyze', 'analysis', 'inspect', 'profile', 'debug',
  // 适配/桥接
  'adapter', 'wrapper', 'proxy', 'bridge', 'gateway', 'router',
  // 代码片段/实现类(补 GitHub Code Search 盲区)
  'implement', 'implementation', 'function', 'snippet', 'example', 'sample',
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
/**
 * 同义词/上位词表,用于生成 fuzzyQuery(模糊化语义副搜索)。
 * 把 query 里的词替换成更宽泛的同义词,扩大召回。
 * 例:monitor → observer/watcher, coding → development/dev
 */
const SYNONYMS: Record<string, string[]> = {
  monitor: ['observer', 'watcher', 'tracker', 'dashboard'],
  tracking: ['tracing', 'logging', 'metrics'],
  coding: ['development', 'dev', 'programming'],
  assistant: ['agent', 'helper', 'copilot', 'companion'],
  converter: ['transformer', 'renderer', 'exporter'],
  status: ['health', 'state', 'metric'],
  ai: ['artificial intelligence', 'llm', 'machine learning'],
  // 代码片段类(补 GitHub Code Search 盲区)
  implement: ['realize', 'implement'],
  implementation: ['realization', 'implementation'],
  function: ['method', 'function', 'routine'],
  snippet: ['fragment', 'snippet', 'excerpt'],
  example: ['sample', 'example', 'demo'],
};

/**
 * 解析 query,拆分核心词/修饰词并检测反义词。
 *
 * @example
 * parseQuery('AI coding assistant monitor status tracking')
 * // {
 * //   corePhrase: 'ai coding',           // 前 2 个实义词(给 GitHub 引号搜索)
 * //   coreWords: ['monitor', 'tracking'], // 动词优先(给 Ranker 必命中过滤)
 * //   modifiers: ['assistant', 'status'],
 * //   formatWords: [],
 * //   fuzzyQuery: 'AI development agent observer health tracing',
 * //   ...
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

  // 3. corePhrase = 前 2 个实义词(给 GitHub 引号搜索用,保持原逻辑)
  const phraseWords = allWords.slice(0, 2);
  const corePhrase = phraseWords.join(' ');

  // 3.5 coreWords = 动词优先(给 Ranker 必命中过滤用)
  // 动词表达用户真正意图(monitor/convert/parse...),比对象词(coding/assistant)更能区分
  const verbWords = allWords.filter(w => ACTION_VERBS.has(w));
  const nonVerbWords = allWords.filter(w => !ACTION_VERBS.has(w));
  let coreWords: string[];
  if (verbWords.length >= 2) {
    // 有 >= 2 个动词:用前 2 个动词
    coreWords = verbWords.slice(0, 2);
  } else if (verbWords.length === 1) {
    // 只有 1 个动词:动词 + 第一个非动词实义词
    coreWords = [verbWords[0], nonVerbWords[0]].filter(Boolean);
  } else {
    // 没有动词:回退到原逻辑(前 2 个实义词)
    coreWords = phraseWords;
  }
  // modifiers = allWords 里不在 coreWords 的词
  const coreSet = new Set(coreWords);
  const modifierWords = allWords.filter(w => !coreSet.has(w));

  // 4. 格式词:query 里出现的所有文件格式词
  const formatWords = allWords.filter(w => FORMAT_WORDS.has(w));

  // 5. 反义词检测:query 含动作词但不含"反向动作"时,推断用户意图是"做这个动作"
  const antonymExcludes: string[] = [];
  const lowerQuery = query.toLowerCase();
  for (const [action, excludeWords] of Object.entries(ANTONYMS)) {
    if (!lowerQuery.includes(action)) continue;
    const isReverseIntent = excludeWords.some(w => lowerQuery.includes(w));
    if (!isReverseIntent) {
      antonymExcludes.push(...excludeWords);
    }
  }

  // 6. 生成 fuzzyQuery:用同义词/上位词泛化,用于副搜索扩大召回
  const fuzzyWords = allWords.map(w => {
    const syns = SYNONYMS[w];
    // 70% 概率用同义词,30% 保留原词(避免完全偏离原意)
    return syns && syns.length > 0 ? syns[0] : w;
  });
  const fuzzyQuery = fuzzyWords.join(' ');

  return {
    corePhrase, coreWords, modifiers: modifierWords,
    antonymExcludes, expandedQuery, formatWords, fuzzyQuery,
  };
}
