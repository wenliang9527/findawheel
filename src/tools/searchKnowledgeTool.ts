// src/tools/searchKnowledgeTool.ts
// search_knowledge MCP 工具:搜索用户个人知识库(本地 Markdown 文件夹)。
//
// 与 find_wheel 解耦:
// - find_wheel 用于搜索现成的开源轮子(GitHub/npm/crates 等)
// - search_knowledge 用于搜索用户自己的笔记/wiki/ADR/内部文档
// AI 根据意图自行决定调用哪个工具。

import { searchKnowledgeBase, type KnowledgeItem, type KbType } from '../knowledge/knowledgeBase.js';
import type { EnvConfig } from '../util/env.js';
import { BASE_STOPWORDS } from '../util/stopwords.js';
import { sha1Short } from '../util/hash.js';

export interface SearchKnowledgeInput {
  query: string;
  limit?: number;
}

export interface SearchKnowledgeOutput {
  query: string;
  total: number;
  items: KnowledgeItem[];
  /** 识别到的知识库类型(去重,如 ['obsidian'] 或 ['plain', 'obsidian']) */
  kbTypes?: KbType[];
  /** 提示信息:知识库未启用 / 没有匹配结果 等 */
  hint?: string;
}

/**
 * 计算 knowledge base 搜索的 cache key。
 *
 * key 构成:kbRoots + keywords + limit + maxFileKb
 * 不含 query 原文(已分词为 keywords),避免大小写/标点差异导致 cache miss。
 * 前缀 'kb:' 与 find_wheel 的 cache key 空间隔离。
 */
function kbCacheKey(
  kbRoots: string[],
  keywords: string[],
  limit: number,
  maxFileKb: number,
): string {
  const raw = `${kbRoots.join(',')}|${keywords.join(',')}|${limit}|${maxFileKb}`;
  return 'kb:' + sha1Short(raw);
}

export interface SearchKnowledgeToolOpts {
  /** 可选缓存实例(由 server.ts 注入,仅当 kbCacheEnabled=true 时传入) */
  cache?: {
    dedupe<U>(key: string, fn: () => Promise<U>): Promise<U>;
  };
}

/**
 * 执行知识库搜索。
 *
 * @param input 用户输入(query + 可选 limit)
 * @param env 配置(读取 kbEnabled/kbRoots/kbMaxFileKb/kbCacheEnabled)
 * @param opts 可选工具配置(注入 cache 实例)
 * @returns 搜索结果
 */
export async function searchKnowledge(
  input: SearchKnowledgeInput,
  env: EnvConfig,
  opts?: SearchKnowledgeToolOpts,
): Promise<SearchKnowledgeOutput> {
  // 1. 检查知识库是否启用
  if (!env.kbEnabled) {
    return {
      query: input.query,
      total: 0,
      items: [],
      hint: 'Knowledge base search is disabled. Set FINDAWHEEL_KB_ENABLED=true and FINDAWHEEL_KB_ROOT=<path> to enable.',
    };
  }

  // 2. 检查根目录配置
  if (env.kbRoots.length === 0) {
    return {
      query: input.query,
      total: 0,
      items: [],
      hint: 'No knowledge base root configured. Set FINDAWHEEL_KB_ROOT=<path> (comma-separated for multiple).',
    };
  }

  // 3. 简单分词(按空格/标点切分,过滤停用词)
  // 不复用 queryParser 的复杂逻辑,因为知识库搜索是字面匹配,不需要翻译/同义词
  const keywords = input.query
    .toLowerCase()
    .split(/[\s,，。、;；!！?？]+/)
    .filter(w => w.length > 1)
    .filter(w => !BASE_STOPWORDS.has(w));

  if (keywords.length === 0) {
    return {
      query: input.query,
      total: 0,
      items: [],
      hint: 'Query too short or only contains stopwords.',
    };
  }

  const limit = Math.min(input.limit ?? 10, 50);

  // 4. 调用适配器搜索
  // 缓存可选:默认 kbCacheEnabled=false,每次扫描保证最新
  // 用户显式开启 kbCacheEnabled=true 时,走主缓存(与 find_wheel 共享 cacheDir,
  // 但 key 空间隔离:kb: 前缀),TTL 1h
  const fetchItems = () => searchKnowledgeBase(env.kbRoots, {
    keywords,
    limit,
    maxFileKb: env.kbMaxFileKb,
  });

  const items = (env.kbCacheEnabled && opts?.cache)
    ? await opts.cache.dedupe(
        kbCacheKey(env.kbRoots, keywords, limit, env.kbMaxFileKb),
        fetchItems,
      )
    : await fetchItems();

  // 从结果中提取识别到的知识库类型(去重)
  const kbTypes = items.length > 0
    ? [...new Set(items.map(i => i.kbType))]
    : undefined;

  return {
    query: input.query,
    total: items.length,
    items,
    kbTypes,
    hint: items.length === 0
      ? 'No matching documents found in knowledge base.'
      : undefined,
  };
}
