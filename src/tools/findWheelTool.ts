// src/tools/findWheelTool.ts
import type { SourceAdapter } from '../sources/sourceAdapter.js';
import type {
  FindWheelInput, FindWheelOutput, Intent, RawResult, Wheel,
} from '../normalize/types.js';
import { classify } from '../classifier/queryClassifier.js';
import { extractKeywords } from '../classifier/queryTranslator.js';
import { parseQuery } from '../classifier/queryParser.js';
import { normalize } from '../normalize/normalizer.js';
import { enrich } from '../enrich/metricsEnricher.js';
import { rank } from '../rank/ranker.js';
import { enrichWithMatch } from '../rank/recommender.js';
import { readEnv } from '../util/env.js';
import { SourceError } from '../errors.js';
import { createCache, cacheKey, type Cache } from '../cache/cache.js';

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface CreateToolOpts {
  adapters: SourceAdapter[];
  /** 可选缓存实例(测试注入);未提供时按 env 配置创建磁盘缓存 */
  cache?: Cache;
}

/** 搜索流程的中间结果 */
interface SearchResult {
  wheels: Wheel[];
  degraded: string[];
  allFailed: boolean;
}

export function createFindWheelTool(opts: CreateToolOpts) {
  const env = readEnv();
  const cache: Cache = opts.cache ?? createCache({
    dir: env.cacheDir,
    ttlMs: env.cacheTtlMs,
    enabled: env.cacheEnabled,
  });

  async function handle(input: FindWheelInput): Promise<McpToolResult> {
    if (!input.query || input.query.trim() === '') {
      return {
        content: [{ type: 'text', text: 'query is required' }],
        isError: true,
      };
    }
    const intent: Intent = classify(input.query, input.intent);
    const limit = input.limit ?? env.limit;

    // 缓存命中:直接返回(跨会话复用磁盘缓存)
    const key = cacheKey(input.query, intent, input.ecosystem, limit);
    const cached = await cache.get(key);
    if (cached) {
      const output: FindWheelOutput = {
        query: input.query,
        intent,
        total: cached.length,
        wheels: cached,
        summary: buildSummary(cached),
        cached: true,
      };
      return { content: [{ type: 'text', text: JSON.stringify(output) }] };
    }

    // 未命中:用 dedupe 包裹搜索流程,同 key 并发只执行一次
    const result = await cache.dedupe(key, () => runSearch(input, intent, limit));

    if (result.allFailed) {
      return {
        content: [{ type: 'text', text: 'all data sources unavailable' }],
        isError: true,
      };
    }

    // 成功才写缓存(失败结果不缓存,避免下次命中错误响应)
    await cache.set(key, result.wheels);

    const output: FindWheelOutput = {
      query: input.query,
      intent,
      total: result.wheels.length,
      wheels: result.wheels,
      summary: buildSummary(result.wheels),
      ...(result.degraded.length > 0 ? { degradedSources: result.degraded } : {}),
    };
    return { content: [{ type: 'text', text: JSON.stringify(output) }] };
  }

  /** 执行主搜索 + 副搜索,归一化、排序、填充推荐信息 */
  async function runSearch(
    input: FindWheelInput, intent: Intent, limit: number,
  ): Promise<SearchResult> {
    const timeoutMs = env.timeoutMs;
    // 解析 query:拆分核心短语/修饰词/反义词,让数据源做更精准的搜索
    const parsedQuery = parseQuery(input.query);

    const searchOpts = {
      intent, ecosystem: input.ecosystem, timeoutMs,
      githubToken: env.githubToken,
      gitlabToken: env.gitlabToken,
      librariesIoApiKey: env.librariesIoApiKey,
      exaApiKey: env.exaApiKey,
      tavilyApiKey: env.tavilyApiKey,
      parsedQuery,
    };
    // 副搜索:用 fuzzyQuery(同义词泛化)扩大召回,不传 parsedQuery(让 adapter 走兜底)
    const fuzzyOpts = {
      intent, ecosystem: input.ecosystem, timeoutMs,
      githubToken: env.githubToken,
      gitlabToken: env.gitlabToken,
      librariesIoApiKey: env.librariesIoApiKey,
      exaApiKey: env.exaApiKey,
      tavilyApiKey: env.tavilyApiKey,
    };

    // 主搜索 + 副搜索并行,结果合并去重(由 rank() 的 dedupe 处理)
    const [mainSettled, fuzzySettled] = await Promise.all([
      Promise.allSettled(opts.adapters.map(a => a.search(input.query, searchOpts))),
      Promise.allSettled(opts.adapters.map(a => a.search(parsedQuery.fuzzyQuery, fuzzyOpts))),
    ]);

    const allRaw: RawResult[] = [];
    const degraded: string[] = [];
    let allFailed = true;
    // 收集主搜索结果
    for (let i = 0; i < mainSettled.length; i++) {
      const r = mainSettled[i];
      const name = opts.adapters[i].name;
      if (r.status === 'fulfilled') {
        allRaw.push(...r.value);
        if (r.value.length > 0) allFailed = false;
      } else {
        // 主搜索失败才记为 degraded(副搜索失败不算,因为副搜索是补充)
        if (!fuzzySettled[i] || fuzzySettled[i].status !== 'fulfilled') {
          degraded.push(name);
        }
      }
    }
    // 收集副搜索结果(追加到 allRaw,后续 dedupe 会按 name 去重)
    for (const r of fuzzySettled) {
      if (r.status === 'fulfilled') {
        allRaw.push(...r.value);
        allFailed = false;
      }
    }
    // If any source succeeded (even with 0 results), it's not all-failed
    if (mainSettled.some(r => r.status === 'fulfilled')) allFailed = false;

    if (allFailed) {
      return { wheels: [], degraded, allFailed: true };
    }

    const wheels: Wheel[] = allRaw.map(normalize).map(enrich);
    // 提取 query 关键词(含中文翻译后的英文),用于排序时描述匹配加分
    const queryKeywords = extractKeywords(input.query);
    // 反义词排除列表传给 Ranker 过滤反向意图;核心词和格式词用于必命中过滤
    const ranked = rank(
      wheels, intent, limit, queryKeywords,
      parsedQuery.antonymExcludes, parsedQuery.coreWords, parsedQuery.formatWords,
    );
    // 给每个结果填充推荐信息(matchScore + recommendation 等级 + reason 理由)
    // 让调用方 AI 看到结构化的推荐等级,倾向于列出多个结果让用户选择
    const rankedWithMatch = enrichWithMatch(ranked, queryKeywords);
    return { wheels: rankedWithMatch, degraded, allFailed: false };
  }

  return { handle };
}

/** 推荐等级的中文标签 + 排序顺序 */
const REC_LABELS: Record<string, string> = {
  highly_recommended: '强烈推荐',
  recommended: '推荐',
  optional: '可选',
  not_recommended: '不推荐',
};
const REC_ORDER = ['highly_recommended', 'recommended', 'optional', 'not_recommended'];

/**
 * 生成结构化 summary:按推荐等级分组,明确列出所有结果名。
 * 目的:让 AI 看到明确的列表结构,倾向于列全所有结果而非只挑 1 个。
 */
function buildSummary(wheels: Wheel[]): FindWheelOutput['summary'] {
  // 按推荐等级分组
  const byLevel = new Map<string, string[]>();
  for (const w of wheels) {
    const level = w.match?.recommendation ?? 'optional';
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level)!.push(w.name);
  }
  // 按固定顺序输出(强烈推荐 → 推荐 → 可选 → 不推荐)
  const groups = REC_ORDER
    .filter(level => byLevel.has(level) && byLevel.get(level)!.length > 0)
    .map(level => ({
      level: level as FindWheelOutput['summary']['groups'][0]['level'],
      label: REC_LABELS[level],
      items: byLevel.get(level)!,
    }));
  const totalCount = wheels.length;
  return {
    instruction: `共找到 ${totalCount} 个结果。请将所有结果按以下分组列给用户,不要只展示 1 个。每组展示项目名 + 推荐理由 + stars,让用户对比选择。`,
    groups,
  };
}
