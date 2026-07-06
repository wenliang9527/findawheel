// src/tools/findWheelTool.ts
import type { SourceAdapter } from '../sources/sourceAdapter.js';
import type {
  FindWheelInput, FindWheelOutput, Intent, RawResult, Wheel,
} from '../normalize/types.js';
import { classify } from '../classifier/queryClassifier.js';
import { extractKeywords } from '../classifier/queryTranslator.js';
import { parseQuery } from '../classifier/queryParser.js';
import { translateQuery } from '../classifier/queryTranslator.js';
import { routeSources, type RoutingResult } from '../classifier/sourceRouter.js';
import { normalize } from '../normalize/normalizer.js';
import { enrich } from '../enrich/metricsEnricher.js';
import { rank } from '../rank/ranker.js';
import { enrichWithMatch, REC_LABELS, REC_ORDER } from '../rank/recommender.js';
import { readEnv } from '../util/env.js';
import { logError, logInfo } from '../util/logger.js';
import { createCache, cacheKey, type Cache } from '../cache/cache.js';
import {
  enrichDetails,
  type WheelDetails,
  type EnrichDetailsOpts,
} from '../enrich/wheelDetailsEnricher.js';
import { detailsCacheKey } from './getWheelDetailsTool.js';
import type { FeedbackStore } from '../feedback/feedbackStore.js';
import { applyFeedbackToWheels } from '../feedback/feedbackWeighter.js';
import type { McpToolResult } from './types.js';

export interface CreateToolOpts {
  adapters: SourceAdapter[];
  /** 可选缓存实例(测试注入);未提供时按 env 配置创建磁盘缓存 */
  cache?: Cache;
  /** 可选详情缓存实例(与 get_wheel_details 工具共享,预抓取的详情写入此处供懒加载复用) */
  detailsCache?: Cache<WheelDetails>;
  /** 可选详情抓取配置;未提供时不做预抓取(保持原行为,向后兼容) */
  enrichOpts?: EnrichDetailsOpts;
  /** 可选反馈存储实例;提供时搜索结果按用户历史反馈(like/hide/click)调整排序 */
  feedbackStore?: FeedbackStore;
}

/** 搜索流程的中间结果 */
interface SearchResult {
  wheels: Wheel[];
  degraded: string[];
  allFailed: boolean;
  /** 路由信息:被跳过的源 + 原因(供输出 skippedSources/routingReason) */
  routing?: RoutingResult;
  /** 是否触发了兜底扩展(true=原本跳过的源因召回不足被重新搜索) */
  expandedFallback?: boolean;
}

/** 兜底扩展阈值:top 1 stars < LOW_STARS_THRESHOLD 或总结果 < FALLBACK_MIN_RESULTS 条时触发 */
const FALLBACK_TOP_STARS_THRESHOLD = 10;
const FALLBACK_MIN_RESULTS = 5;
/** 低 star 阈值:低于此值视为低质量结果(用于兜底扩展 + 低质量警告) */
const LOW_STARS_THRESHOLD = 10;

/**
 * 严格限流源:这些源对副搜索(同义词泛化)会双倍消耗配额,跳过副搜索。
 * - github: 5000/hour (token) / 60/hour (anonymous)
 * - github-code: 10 req/min (极严格)
 * - gitee: 5000/hour (token) / 60/hour (anonymous)
 * - gitlab: 1000 req/min (token),但国内不稳定
 *
 * 宽松源(web/huggingface/paperswithcode/vscode-marketplace/pypi/registry/librariesio)
 * 仍并行主+副搜索以最大化召回。
 */
const RATE_LIMITED_SOURCES = new Set(['github', 'github-code', 'gitee', 'gitlab']);

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
    // limit 上限封顶 100,避免恶意传入超大值导致超大缓存写入和响应
    const limit = Math.min(input.limit ?? env.limit, 100);

    // C 阶段:exclude 过滤。用规范化 key(owner/repo 或包名小写)匹配。
    // exclude 是 AI 协作深化的一部分 —— AI 上一轮看到结果后,
    // 识别出某些不相关或反向意图项目,重新搜索时跳过这些。
    const excludeSet = new Set(
      (input.exclude ?? []).map(n => n.toLowerCase()),
    );

    // 缓存命中:直接返回(跨会话复用磁盘缓存)
    const key = cacheKey(input.query, intent, input.ecosystem, limit);
    const cached = await cache.get(key);
    if (cached) {
      logInfo(`cache hit: query="${input.query}" intent=${intent} ${cached.length} wheels`);
      // 缓存命中后也应用 exclude 过滤(让 AI 能用 exclude 二次筛选缓存结果)
      const filtered = excludeSet.size > 0
        ? cached.filter(w => !excludeSet.has(w.name.toLowerCase()))
        : cached;
      const output: FindWheelOutput = {
        query: input.query,
        intent,
        total: filtered.length,
        wheels: filtered,
        summary: buildSummary(filtered),
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
    // 顺序: feedback 加权(重新排序) → exclude 过滤 → 详情预抓取(top 10 按新排序) → 写缓存
    // 缓存存最终结果(含 feedback 调整和 details), 命中时直接返回; feedback 变化等 TTL 刷新
    let finalWheels = result.wheels;
    if (opts.feedbackStore) {
      finalWheels = await applyFeedback(finalWheels);
    }
    // C 阶段:exclude 过滤(AI 二次筛选不相关项目)
    if (excludeSet.size > 0) {
      finalWheels = finalWheels.filter(w => !excludeSet.has(w.name.toLowerCase()));
    }
    // 混合呈现:enrichOpts 配置时对 top 10 预抓取详情,top 3 内联,4-10 加 hasDetails 标记
    // 预抓取失败不阻断主流程(容错);缓存里存的是已内联 details 的 wheels,命中时直接返回
    if (opts.enrichOpts) {
      await enrichTopWheels(finalWheels, opts.enrichOpts, opts.detailsCache);
    }
    await cache.set(key, finalWheels);

    // 构造输出:仅在路由跳过了源(且未触发兜底扩展)时返回 skippedSources/routingReason
    // 触发扩展时所有源都搜过了,不再算"跳过"
    const routingInfo = result.expandedFallback
      ? undefined  // 扩展后不再报告 skipped(全部源都搜过)
      : (result.routing && result.routing.skipped.length > 0
        ? {
            skippedSources: result.routing.skipped,
            routingReason: result.routing.reason,
          }
        : undefined);

    const output: FindWheelOutput = {
      query: input.query,
      intent,
      total: finalWheels.length,
      wheels: finalWheels,
      summary: buildSummary(finalWheels),
      ...(result.degraded.length > 0 ? { degradedSources: result.degraded } : {}),
      ...routingInfo,
    };
    return { content: [{ type: 'text', text: JSON.stringify(output) }] };
  }

  /**
   * 应用用户历史反馈调整 score 和排序。
   * 加载所有 feedback, 对 wheels 批量应用 feedbackWeighter, 重新排序和分级。
   * feedbackStore 未提供或无反馈记录时原样返回。
   */
  async function applyFeedback(wheels: Wheel[]): Promise<Wheel[]> {
    if (!opts.feedbackStore) return wheels;
    const allFeedback = await opts.feedbackStore.getAllFeedback();
    if (allFeedback.length === 0) return wheels;
    const feedbackMap = new Map(allFeedback.map(f => [f.name, f]));
    return applyFeedbackToWheels(wheels, feedbackMap);
  }

  /** 执行主搜索 + 副搜索,归一化、排序、填充推荐信息 */
  async function runSearch(
    input: FindWheelInput, intent: Intent, limit: number,
  ): Promise<SearchResult> {
    const timeoutMs = env.timeoutMs;
    // 解析 query:拆分核心短语/修饰词,让数据源做更精准的搜索
    const parsedQuery = parseQuery(input.query);
    const translated = translateQuery(input.query);

    // ===== 智能路由:根据 query 类型选择数据源子集 =====
    // 强信号(hardware/python/ui 等)时只搜选中源,跳过明显不相关的源
    // 兜底:无强信号匹配时全搜(保持现有行为)
    const routing = routeSources({
      query: input.query,
      translatedQuery: translated,
      ecosystem: input.ecosystem ?? parsedQuery.ecosystem,
      intent,
      parsedQuery,
    });

    const selectedAdapters = opts.adapters.filter(a => routing.selected.includes(a.name));
    const skippedAdapters = opts.adapters.filter(a => routing.skipped.includes(a.name));

    const searchOpts = {
      intent, ecosystem: input.ecosystem, timeoutMs,
      githubToken: env.githubToken,
      gitlabToken: env.gitlabToken,
      giteeToken: env.giteeToken,
      librariesIoApiKey: env.librariesIoApiKey,
      exaApiKey: env.exaApiKey,
      tavilyApiKey: env.tavilyApiKey,
      parsedQuery,
    };
    // 副搜索:用 fuzzyQuery(同义词泛化)扩大召回,复用 searchOpts 但去掉 parsedQuery(让 adapter 走兜底)
    const { parsedQuery: _omit, ...fuzzyOpts } = searchOpts;
    void _omit;

    // O1:严格限流源(github/github-code/gitee/gitlab)跳过副搜索,避免双倍消耗配额。
    // 副搜索用同义词泛化,与主搜索高度重叠,对限流源 ROI 低。
    const fuzzyAdapters = selectedAdapters.filter(a => !RATE_LIMITED_SOURCES.has(a.name));

    // 主搜索(全量源)+ 副搜索(仅宽松源)并行,结果合并去重(由 rank() 的 dedupe 处理)
    const [mainSettled, fuzzySettled] = await Promise.all([
      Promise.allSettled(selectedAdapters.map(a => a.search(input.query, searchOpts))),
      Promise.allSettled(fuzzyAdapters.map(a => a.search(parsedQuery.fuzzyQuery, fuzzyOpts))),
    ]);

    const allRaw: RawResult[] = [];
    const degraded: string[] = [];
    let allFailed = true;
    // 收集主搜索结果
    for (let i = 0; i < mainSettled.length; i++) {
      const r = mainSettled[i];
      const name = selectedAdapters[i].name;
      if (r.status === 'fulfilled') {
        allRaw.push(...r.value);
        // 主搜索 fulfilled 即视为该源可用(即使返回空数组)
        allFailed = false;
      } else {
        // 主搜索失败:无论副搜索是否成功,都标记该源为 degraded
        // 原因:主搜索是用户 query 的精确召回,主失败意味着精确召回丢失,
        // 副搜索(同义词泛化)只能补充召回,不能替代主搜索的精确性。
        // AI 需要知道哪些源的主搜索失败了,以便判断结果是否可信。
        degraded.push(name);
        logError(`${name} main search failed`, r.reason);
      }
    }
    // 收集副搜索结果(追加到 allRaw,后续 dedupe 会按 name 去重)
    for (const r of fuzzySettled) {
      if (r.status === 'fulfilled') {
        allRaw.push(...r.value);
      } else {
        // 副搜索失败不影响 allFailed 判定,但记录错误原因便于诊断
        logError('fuzzy search failed', r.reason);
      }
    }

    if (allFailed) {
      return { wheels: [], degraded, allFailed: true, routing };
    }

    let wheels: Wheel[] = allRaw.map(w => enrich(normalize(w)));
    // 提取 query 关键词(含中文翻译后的英文),用于排序时描述匹配加分
    const queryKeywords = extractKeywords(input.query);
    // Phase 6 简化:删除领域泛词过滤和 coreWords 过滤。
    // 相关性判断交给 AI 调用方 —— AI 看到 top N 结果后自己挑最适合的。
    // 硬规则过滤(isMissingCoreConcept)容易误杀主流库,得不偿失。
    let rankedWithMatch = collectAndRank(wheels, intent, limit, queryKeywords);

    // ===== 兜底扩展:召回不足时搜索被跳过的源 =====
    // 严格阈值:top 1 stars < 10 或总结果 < 5 条 → 扩展到全源重搜
    // 仅当本次路由跳过了源(skipped.length > 0)时才可能触发扩展
    let expandedFallback = false;
    if (routing.skipped.length > 0 && skippedAdapters.length > 0) {
      const topStars = rankedWithMatch[0]?.metrics.stars ?? 0;
      const totalResults = rankedWithMatch.length;
      const needsExpansion = totalResults < FALLBACK_MIN_RESULTS || topStars < FALLBACK_TOP_STARS_THRESHOLD;
      if (needsExpansion) {
        logInfo(`fallback expansion triggered: topStars=${topStars} results=${totalResults} → search ${skippedAdapters.length} skipped sources`);
        // O1:兜底扩展也跳过限流源的副搜索
        const extFuzzyAdapters = skippedAdapters.filter(a => !RATE_LIMITED_SOURCES.has(a.name));
        // 搜索被跳过的源,合并结果后重新 rank
        const [extMain, extFuzzy] = await Promise.all([
          Promise.allSettled(skippedAdapters.map(a => a.search(input.query, searchOpts))),
          Promise.allSettled(extFuzzyAdapters.map(a => a.search(parsedQuery.fuzzyQuery, fuzzyOpts))),
        ]);
        // 收集扩展结果
        const extRaw: RawResult[] = [];
        for (let i = 0; i < extMain.length; i++) {
          const r = extMain[i];
          if (r.status === 'fulfilled') {
            extRaw.push(...r.value);
          } else {
            // 扩展阶段失败的源也加入 degraded(让 AI 知道哪些源不可用)
            const name = skippedAdapters[i].name;
            if (!degraded.includes(name)) degraded.push(name);
            logError(`${name} fallback search failed`, r.reason);
          }
        }
        for (const r of extFuzzy) {
          if (r.status === 'fulfilled') extRaw.push(...r.value);
          else logError('fallback fuzzy search failed', r.reason);
        }
        if (extRaw.length > 0) {
          // 合并扩展结果到主结果,重新 rank
          wheels = [...wheels, ...extRaw.map(w => enrich(normalize(w)))];
          rankedWithMatch = collectAndRank(wheels, intent, limit, queryKeywords);
        }
        // 无论扩展是否带来新结果,都标记为已扩展(避免下次重复扩展,也避免误报 skippedSources)
        expandedFallback = true;
        // 扩展后即使仍不足,也不再二次扩展(避免无限循环)
      }
    }

    return { wheels: rankedWithMatch, degraded, allFailed: false, routing, expandedFallback };
  }

  return { handle };
}

/**
 * 归一化 + 排序 + 填充推荐信息(P1-5:抽离避免主搜与兜底扩展重复)。
 *
 * @param wheels 已 normalize+enrich 的 wheels(主搜)或合并后的 wheels(兜底扩展)
 * @returns 排好序且带 matchScore/recommendation 的 wheels
 */
function collectAndRank(
  wheels: Wheel[],
  intent: Intent,
  limit: number,
  queryKeywords: string[],
): Wheel[] {
  const ranked = rank(wheels, intent, limit, queryKeywords);
  return enrichWithMatch(ranked, queryKeywords);
}

/** 混合呈现:对 top 10 预抓取详情,top 3 内联 details,4-10 加 hasDetails 标记 */
const TOP_INLINE = 3;   // top 3 内联 WheelDetails
const TOP_PREFETCH = 10; // top 10 预抓取写 details 缓存

/**
 * 对排名靠前的 wheels 预抓取详情,实现混合呈现:
 * - top 3:内联 wheel.details = WheelDetails(AI 直接拿到 README 摘要/代码示例/release/license)
 * - top 4-10:加 wheel.hasDetails = true(提示 AI 可调 get_wheel_details 懒加载)
 * - 成功抓取的详情写入 detailsCache(若提供),供 get_wheel_details 工具复用,避免重复抓取
 *
 * 容错:enrichDetails 失败或返回 null(非 GitHub 源)时,该 wheel 不加任何标记,不影响主流程。
 * 并行抓取 top 10,任一失败不阻断其他。
 */
async function enrichTopWheels(
  wheels: Wheel[],
  enrichOpts: EnrichDetailsOpts,
  detailsCache?: Cache<WheelDetails>,
): Promise<void> {
  if (wheels.length === 0) return;
  const prefetchCount = Math.min(TOP_PREFETCH, wheels.length);
  const top = wheels.slice(0, prefetchCount);

  // 并行抓取 top 10 详情,任一失败容错(不阻断其他)
  const results = await Promise.allSettled(
    top.map(w => enrichDetails(w, enrichOpts)),
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status !== 'fulfilled') {
      // 详情抓取失败:记录原因便于诊断(rate limit/网络错误等),不阻断其他 wheel
      logError(`details prefetch failed for ${top[i].name}`, r.reason);
      continue;
    }
    const details = r.value;
    if (!details) continue; // 非 GitHub 源:跳过,不加标记

    // 写 details 缓存(供 get_wheel_details 懒加载复用)
    if (detailsCache) {
      try {
        await detailsCache.set(detailsCacheKey(top[i].name), details);
      } catch (err) {
        logError('details prefetch failed', err);
        // 缓存写入失败不阻断(磁盘满等极端情况)
      }
    }

    // top 3 内联 details;其余加 hasDetails 标记
    if (i < TOP_INLINE) {
      top[i].details = details;
    } else {
      top[i].hasDetails = true;
    }
  }
}

/** 推荐等级的中文标签 + 排序顺序 — 已移到 src/rank/recommender.ts 共享层 */
// REC_LABELS / REC_ORDER 现集中定义在 recommender.ts,
// 避免与 gradeRecommendation 等级定义脱节。

/**
 * 生成结构化 summary:按推荐等级分组,明确列出所有结果名。
 * 目的:让 AI 看到明确的列表结构,倾向于列全所有结果而非只挑 1 个。
 *
 * 低质量结果警告:当 top 1 结果(按排序最高) stars < 10 时触发,
 * 提示 AI 建议用户换更宽泛的 query 或调用 suggest_queries 工具。
 * 场景:小众领域 query 命中的全是个人项目,参考价值低,
 * 与其让用户误以为"这就是最好的",不如明确提示召回质量不高。
 */
function buildSummary(wheels: Wheel[]): FindWheelOutput['summary'] {
  // 按推荐等级分组(P1-13:用 ?? [] 替代非空断言 !)
  const byLevel = new Map<string, string[]>();
  for (const w of wheels) {
    const level = w.match?.recommendation ?? 'optional';
    const arr = byLevel.get(level) ?? [];
    arr.push(w.name);
    byLevel.set(level, arr);
  }
  // 按固定顺序输出(强烈推荐 → 推荐 → 可选 → 不推荐)
  const groups = REC_ORDER
    .filter(level => (byLevel.get(level)?.length ?? 0) > 0)
    .map(level => {
      const items = byLevel.get(level) ?? [];
      return {
        // P1-13:level 已是 Recommendation 类型(来自 REC_ORDER),无需类型断言
        level,
        label: REC_LABELS[level],
        items,
      };
    });
  const totalCount = wheels.length;

  // 低质量结果检测:top 1 结果 stars < LOW_STARS_THRESHOLD 时加警告
  // wheels 已按 score 降序排列,top 1 = wheels[0]
  let warning: string | undefined;
  if (wheels.length > 0) {
    const topStars = wheels[0].metrics.stars ?? 0;
    if (topStars < LOW_STARS_THRESHOLD) {
      warning = `⚠️ 召回质量警告:top 1 结果仅 ${topStars} stars,可能未命中主流库。建议:(1) 换更宽泛的 query(如去掉平台名/修饰词);(2) 调用 suggest_queries 工具生成搜索词变体;(3) 尝试用更精准的英文关键词重新搜索。`;
    }
  }

  return {
    instruction: `共找到 ${totalCount} 个结果。请对比 top 5 结果的 stars/lastUpdated/description,选最适合用户场景的 2-3 个推荐给用户,说明选择理由。不要只推荐 1 个,让用户有选择权。同时注意:结果可能含不相关项目(如反向意图"remove watermark"),需自行识别并跳过。`,
    groups,
    ...(warning ? { warning } : {}),
  };
}
