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

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface CreateToolOpts {
  adapters: SourceAdapter[];
}

export function createFindWheelTool(opts: CreateToolOpts) {
  const env = readEnv();

  async function handle(input: FindWheelInput): Promise<McpToolResult> {
    if (!input.query || input.query.trim() === '') {
      return {
        content: [{ type: 'text', text: 'query is required' }],
        isError: true,
      };
    }
    const intent: Intent = classify(input.query, input.intent);
    const limit = input.limit ?? env.limit;
    const timeoutMs = env.timeoutMs;
    // 解析 query:拆分核心短语/修饰词/反义词,让数据源做更精准的搜索
    const parsedQuery = parseQuery(input.query);

    const searchOpts = {
      intent, ecosystem: input.ecosystem, timeoutMs, githubToken: env.githubToken,
      parsedQuery,
    };
    // 副搜索:用 fuzzyQuery(同义词泛化)扩大召回,不传 parsedQuery(让 adapter 走兜底)
    const fuzzyOpts = {
      intent, ecosystem: input.ecosystem, timeoutMs, githubToken: env.githubToken,
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
      return {
        content: [{ type: 'text', text: 'all data sources unavailable' }],
        isError: true,
      };
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
    const output: FindWheelOutput = {
      query: input.query,
      intent,
      total: allRaw.length,
      wheels: rankedWithMatch,
      ...(degraded.length > 0 ? { degradedSources: degraded } : {}),
    };
    return { content: [{ type: 'text', text: JSON.stringify(output) }] };
  }

  return { handle };
}
