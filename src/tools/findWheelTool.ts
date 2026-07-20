// src/tools/findWheelTool.ts
import type { SourceAdapter } from '../sources/sourceAdapter.js';
import type {
  FindWheelInput, FindWheelOutput, Intent, RawResult, Wheel,
} from '../normalize/types.js';
import { GITHUB_CODE_PATH_SEP } from '../normalize/types.js';
import { classify } from '../classifier/queryClassifier.js';
import { extractKeywords } from '../classifier/queryTranslator.js';
import { parseQuery } from '../classifier/queryParser.js';
import { translateQuery } from '../classifier/queryTranslator.js';
import { routeSources, type RoutingResult } from '../classifier/sourceRouter.js';
import { normalize } from '../normalize/normalizer.js';
import { enrich } from '../enrich/metricsEnricher.js';
import { rank, applyIntentBoost } from '../rank/ranker.js';
import { enrichWithMatch, REC_LABELS, REC_ORDER } from '../rank/recommender.js';
import { readEnv } from '../util/env.js';
import { logError, logInfo } from '../util/logger.js';
import { isRateLimited, markRateLimited } from '../util/rateLimitCircuitBreaker.js';
import { RateLimitError } from '../errors.js';
import { createCache, cacheKey, type Cache } from '../cache/cache.js';
import {
  enrichDetails,
  type WheelDetails,
  type EnrichDetailsOpts,
} from '../enrich/wheelDetailsEnricher.js';
import { detailsCacheKey } from './shared.js';
import type { FeedbackStore } from '../feedback/feedbackStore.js';
import { applyFeedbackToWheels } from '../feedback/feedbackWeighter.js';
import type { McpToolResult } from './types.js';

export interface CreateToolOpts {
  adapters: SourceAdapter[];
  /** 可选缓存实例(测试注入);未提供时按 env 配置创建磁盘缓存 */
  cache?: Cache<CachedSearchResult | Wheel[]>;
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
  /** N12:翻译后的 query(中英合并),供 output.translatedQuery 字段使用 */
  translatedQuery?: string;
  /** 本次请求中被限流的源(被熔断跳过或搜索时触 403/429),供输出 rateLimitedSources 告知 AI */
  rateLimited?: string[];
}

/**
 * 缓存值结构(修复2):wheels + routingInfo 一起序列化。
 * 缓存命中时从 routing 恢复 skippedSources/routingReason/fallbackExpansion 到 output,
 * 避免 AI 调试召回偏差时丢失路由上下文。
 * 向后兼容:旧缓存是纯 Wheel[](无 routing 字段),读取时检测 Array.isArray 兜底。
 */
interface CachedSearchResult {
  wheels: Wheel[];
  /** 路由信息(供缓存命中时恢复到 output) */
  routing?: {
    skippedSources?: string[];
    routingReason?: string;
    fallbackExpansion?: { reason: string };
  };
}

/** 兜底扩展阈值:top 1 stars < LOW_STARS_THRESHOLD 或总结果 < FALLBACK_MIN_RESULTS 条时触发 */
const FALLBACK_TOP_STARS_THRESHOLD = 10;
const FALLBACK_MIN_RESULTS = 5;
/**
 * N4:小众领域差异化阈值 —— 嵌入式/硬件/学术等领域 top1 stars 普遍 < 10,
 * 用原阈值会几乎每次触发全源扩展,路由节省的配额被消耗。
 * 改为更宽松的阈值(小众领域 top1<3 或 results<3 才触发扩展)。
 */
const FALLBACK_TOP_STARS_THRESHOLD_NICHE = 3;
const FALLBACK_MIN_RESULTS_NICHE = 3;
/**
 * N4:小众领域路由规则集合 —— 这些规则命中的 query 通常返回低 star 结果(嵌入式/学术/论文库),
 * 用更宽松的 fallback 阈值,避免几乎每次都触发全源扩展。
 * - hardware-keywords: 硬件/嵌入式,主流库 stars 普遍 < 100
 * - cpp-arduino-ecosystem: C++/Arduino 生态,个人项目为主
 * - paper-algorithm: 学术论文相关,star 量普遍偏低
 */
const NICHE_ROUTING_RULES = new Set([
  'hardware-keywords',
  'cpp-arduino-ecosystem',
  'paper-algorithm',
]);
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

/**
 * N2:全文搜索型源 — 这些源 API 无精确短语语法,对 fuzzyQuery(同义词泛化)召回噪声大。
 * 例:HuggingFace 搜 actuator(motor 同义词)会召回机械臂模型,与 stepper motor 无关。
 * 这些源主搜索已足够(全文匹配召回面广),副搜索 ROI 低且稀释主搜索精确结果。
 */
const FUZZY_NOISY_SOURCES = new Set([
  'huggingface',        // 模型搜索:likes 字段语义不同于 stars,同义词泛化后召回大量无关模型
  'paperswithcode',     // 论文搜索:同义词泛化会召回大量不相关论文
  'vscode-marketplace', // 扩展搜索:全文匹配,同义词泛化召回不相关扩展
]);

/**
 * N11:exclude 过滤 helper。
 * - 普通 wheel:用 name.toLowerCase() 精确匹配
 * - github-code wheel:name 是 "owner/repo#path" 格式,额外检查 owner/repo 部分
 *   场景:AI 想一次性排除整个 facebook/react 仓库的文件级结果,
 *   传 exclude: ["facebook/react"] 即可排除所有 #path 变体
 */
function shouldExclude(wheel: Wheel, excludeSet: Set<string>): boolean {
  const name = wheel.name.toLowerCase();
  if (excludeSet.has(name)) return true;
  // N11:github-code 的 name 是 owner/repo#path,检查 owner/repo 部分
  if (wheel.source === 'github-code') {
    const repo = name.split(GITHUB_CODE_PATH_SEP)[0];
    if (excludeSet.has(repo)) return true;
  }
  return false;
}

export function createFindWheelTool(opts: CreateToolOpts) {
  const env = readEnv();
  const cache: Cache<CachedSearchResult | Wheel[]> = opts.cache ?? createCache<CachedSearchResult | Wheel[]>({
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
      // 修复2:向后兼容检测 —— 旧缓存是纯 Wheel[],新缓存是 { wheels, routing }。
      // 新格式命中时恢复 routingInfo(skippedSources/routingReason/fallbackExpansion)到 output,
      // 避免 AI 调试召回偏差时丢失路由上下文。
      // P2-1/P3-2:cache 泛型为 CachedSearchResult | Wheel[],用 Array.isArray 类型守卫收窄,
      // 替代 as unknown as 双重断言与 cachedEntry!.wheels 非空断言 —— 类型系统可直接保证一致性。
      let cachedWheels = Array.isArray(cached) ? cached : cached.wheels;
      const cachedRouting = Array.isArray(cached) ? undefined : cached.routing;
      logInfo(`cache hit: query="${input.query}" intent=${intent} ${cachedWheels.length} wheels`);
      // P1-1:缓存命中也应用 feedback(缓存存 pre-feedback wheels,每次读取重新应用),
      // 避免用户记录 hide/like 后在 TTL 内命中缓存返回旧排序。
      if (opts.feedbackStore) {
        cachedWheels = await applyFeedback(cachedWheels);
      }
      // 缓存命中后也应用 exclude 过滤(让 AI 能用 exclude 二次筛选缓存结果)
      // N11:用 shouldExclude helper,支持 github-code 的 owner/repo#path 格式
      // P1-1:exclude 过滤在 applyFeedback 之后(用户隐藏的项目应该被过滤)
      const filtered = excludeSet.size > 0
        ? cachedWheels.filter(w => !shouldExclude(w, excludeSet))
        : cachedWheels;
      const output: FindWheelOutput = {
        query: input.query,
        intent,
        total: filtered.length,
        wheels: filtered,
        // 优化8:cache 命中路径无 degraded 信息(不缓存),instruction 不含降级提示
        summary: buildSummary(filtered, []),
        cached: true,
        // 修复2:恢复缓存写入时的路由信息(若为旧格式缓存则无此字段,行为不变)
        ...(cachedRouting ?? {}),
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
    // P1-1 修复:缓存存 pre-feedback wheels(已 enrich),每次读取(命中或未命中)重新应用 feedback。
    //   原顺序:feedback → enrich → cache.set → exclude(缓存污染 feedback 结果,命中时返回旧排序)
    //   新顺序:enrich → cache.set(pre-feedback) → feedback(仅影响本次返回) → exclude
    //   这样用户记录 hide/like 后,即使 TTL 内命中缓存也会重新应用最新 feedback。
    // 修复:exclude 不计入 cacheKey,若把过滤后的子集写入缓存,后续不传 exclude 的请求
    // 会命中缓存拿到缺失结果。改为缓存存全量,exclude 过滤在 cache.set 之后执行。
    let finalWheels = result.wheels;
    // 优化2+7:enrichOpts 配置时对 top 10 预抓取详情写缓存,所有命中 wheel 统一标记 hasDetails=true。
    // 不再内联 details 到返回值(避免 limit=8 时返回 12.8KB),AI 按需调 get_wheel_details 懒加载。
    // 预抓取失败不阻断主流程(容错);缓存里存的是带 hasDetails 标记的 wheels,命中时直接返回
    if (opts.enrichOpts) {
      finalWheels = await enrichTopWheels(finalWheels, opts.enrichOpts, opts.detailsCache);
    }
    // 构造路由信息(修复2:提前到 cache.set 之前,以便缓存写入时一起序列化):
    // - N13:触发兜底扩展时输出 fallbackExpansion,让 AI 知道召回范围已扩大
    // - 修复2:扩展后仍输出原始 routingReason(不输出 skippedSources:扩展后全部源都搜过了),
    //   让 AI 调试召回偏差时知道原本路由跳过了哪些类型的源
    // - 未触发扩展且路由跳过了源时,输出 skippedSources/routingReason
    // - 无路由信息时(如 fallback-all 全搜)两者都不输出
    const routingInfo = result.expandedFallback
      ? {
          fallbackExpansion: {
            reason: 'top 1 stars < 10 or results < 5, expanded to all sources',
          },
          // 修复2:扩展后输出原始 routingReason(不输出 skippedSources,因为全部源都搜过了)
          ...(result.routing && result.routing.skipped.length > 0
            ? { routingReason: result.routing.reason }
            : {}),
        }
      : (result.routing && result.routing.skipped.length > 0
        ? {
            skippedSources: result.routing.skipped,
            routingReason: result.routing.reason,
          }
        : undefined);

    // 缓存存全量结果 + routingInfo(修复2:命中时恢复路由上下文,避免 AI 丢失召回偏差调试信息)
    // P1-1:缓存存 pre-feedback wheels(finalWheels 此时只经过 enrich,未应用 feedback),
    //       命中时由缓存命中路径重新调用 applyFeedback 应用最新反馈。
    // 注意:exclude 不计入 cacheKey,缓存存全量;exclude 过滤在 cache.set 之后执行(仅影响本次返回)
    const cacheValue: CachedSearchResult = { wheels: finalWheels, routing: routingInfo };
    await cache.set(key, cacheValue);
    // P1-1:feedback 在 cache.set 之后应用,只影响本次返回,不污染缓存。
    //   保持 exclude 过滤在 applyFeedback 之后(用户隐藏的项目应该被过滤)。
    if (opts.feedbackStore) {
      finalWheels = await applyFeedback(finalWheels);
    }
    // C 阶段:exclude 过滤(AI 二次筛选不相关项目,仅影响本次返回)
    // N11:用 shouldExclude helper,支持 github-code 的 owner/repo#path 格式
    if (excludeSet.size > 0) {
      finalWheels = finalWheels.filter(w => !shouldExclude(w, excludeSet));
    }

    // 优化6:degradedSources 结构化为 {name, reason},reason 区分 rate_limited/no_api_key/error
    const structuredDegraded = result.degraded.map(name => ({
      name,
      reason: getDegradedReason(name, result.rateLimited ?? []),
    }));

    const output: FindWheelOutput = {
      query: input.query,
      // N12:暴露翻译后的 query,让 AI 知道实际搜了什么英文词(中文 query 翻译后可能不同)
      ...(result.translatedQuery ? { translatedQuery: result.translatedQuery } : {}),
      intent,
      total: finalWheels.length,
      wheels: finalWheels,
      // 优化8:动态 instruction 基于 total + degraded 生成(含降级提示和反向意图提醒)
      summary: buildSummary(finalWheels, structuredDegraded),
      ...(structuredDegraded.length > 0 ? { degradedSources: structuredDegraded } : {}),
      ...(result.rateLimited && result.rateLimited.length > 0 ? { rateLimitedSources: result.rateLimited } : {}),
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
    // N5:key 用 toLowerCase 归一化(与 ranker dedupe 一致),
    // 避免 feedback 存 "Lodash" 而 wheel.name 是 "lodash" 时 get 不命中导致反馈失效
    const feedbackMap = new Map(allFeedback.map(f => [f.name.toLowerCase(), f]));
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

    // 限流熔断:跳过仍处于限流期的源,避免反复触发 403/429 浪费超时。
    // 被熔断跳过的源收集到 rateLimited,在输出中告知 AI(这些源本轮未参与搜索)。
    const rateLimited: string[] = selectedAdapters
      .filter(a => isRateLimited(a.name))
      .map(a => a.name);
    let activeAdapters = selectedAdapters.filter(a => !isRateLimited(a.name));
    // 全部被限流时降级为使用全部源(不能完全无结果)
    if (activeAdapters.length === 0) {
      activeAdapters = selectedAdapters;
      // P2-2:降级时清空 rateLimited,因为实际已搜索这些源(否则输出会误导 AI 以为这些源被跳过)
      rateLimited.length = 0;
    }

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
    // N2:全文搜索型源(huggingface/paperswithcode/vscode-marketplace)也跳过副搜索,
    // 因为这些源 API 无精确短语语法,同义词泛化后召回噪声大,主搜索已足够。
    const fuzzyAdapters = activeAdapters.filter(
      a => !RATE_LIMITED_SOURCES.has(a.name) && !FUZZY_NOISY_SOURCES.has(a.name),
    );

    // 主搜索(全量源)+ 副搜索(仅宽松源)并行,结果合并去重(由 rank() 的 dedupe 处理)
    const [mainSettled, fuzzySettled] = await Promise.all([
      Promise.allSettled(activeAdapters.map(a => a.search(input.query, searchOpts))),
      Promise.allSettled(fuzzyAdapters.map(a => a.search(parsedQuery.fuzzyQuery, fuzzyOpts))),
    ]);

    const allRaw: RawResult[] = [];
    const degraded: string[] = [];
    let allFailed = true;
    // 收集主搜索结果
    for (let i = 0; i < mainSettled.length; i++) {
      const r = mainSettled[i];
      const name = activeAdapters[i].name;
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
        // 限流熔断:记录该源被限流,后续请求在 resetAt 前跳过该源
        if (r.reason instanceof RateLimitError) {
          markRateLimited(name, r.reason.resetAt.getTime());
          if (!rateLimited.includes(name)) rateLimited.push(name);
        }
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
      return { wheels: [], degraded, allFailed: true, routing, translatedQuery: translated, rateLimited };
    }

    let wheels: Wheel[] = allRaw.map(w => enrich(normalize(w)));
    // 提取 query 关键词(含中文翻译后的英文),用于排序时描述匹配加分
    const queryKeywords = extractKeywords(input.query);
    // Phase 6 简化:删除领域泛词过滤和 coreWords 过滤。
    // 相关性判断交给 AI 调用方 —— AI 看到 top N 结果后自己挑最适合的。
    // 硬规则过滤(isMissingCoreConcept)容易误杀主流库,得不偿失。
    let rankedWithMatch = collectAndRank(wheels, intent, limit, queryKeywords);

    // ===== 兜底扩展:召回不足时搜索被跳过的源 =====
    // 严格阈值:top 1 stars < 阈值 或总结果 < 阈值 条 → 扩展到全源重搜
    // 仅当本次路由跳过了源(skipped.length > 0)时才可能触发扩展
    // N4:小众领域(hardware/cpp-arduino/paper)用更宽松的阈值(NICHE 版本),
    // 避免这些领域 top1 stars 普遍偏低导致几乎每次都触发全源扩展,消耗路由节省的配额
    let expandedFallback = false;
    if (routing.skipped.length > 0 && skippedAdapters.length > 0) {
      const topStars = rankedWithMatch[0]?.metrics.stars ?? 0;
      const totalResults = rankedWithMatch.length;
      // N4:按路由类型选择阈值 —— 小众领域用宽松阈值,其他用严格阈值
      const isNicheRoute = NICHE_ROUTING_RULES.has(routing.ruleName);
      const minResultsThreshold = isNicheRoute ? FALLBACK_MIN_RESULTS_NICHE : FALLBACK_MIN_RESULTS;
      const topStarsThreshold = isNicheRoute ? FALLBACK_TOP_STARS_THRESHOLD_NICHE : FALLBACK_TOP_STARS_THRESHOLD;
      const needsExpansion = totalResults < minResultsThreshold || topStars < topStarsThreshold;
      if (needsExpansion) {
        logInfo(`fallback expansion triggered: topStars=${topStars} results=${totalResults} → search ${skippedAdapters.length} skipped sources`);
        // 限流熔断:兜底扩展也跳过仍处于限流期的源
        let extSearchAdapters = skippedAdapters.filter(a => !isRateLimited(a.name));
        // 全部被限流时降级为使用全部源(避免完全无扩展结果)
        if (extSearchAdapters.length === 0) extSearchAdapters = skippedAdapters;
        // O1+N2:兜底扩展也跳过限流源和全文噪声源的副搜索
        const extFuzzyAdapters = extSearchAdapters.filter(
          a => !RATE_LIMITED_SOURCES.has(a.name) && !FUZZY_NOISY_SOURCES.has(a.name),
        );
        // 搜索被跳过的源,合并结果后重新 rank
        const [extMain, extFuzzy] = await Promise.all([
          Promise.allSettled(extSearchAdapters.map(a => a.search(input.query, searchOpts))),
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
            const name = extSearchAdapters[i].name;
            if (!degraded.includes(name)) degraded.push(name);
            logError(`${name} fallback search failed`, r.reason);
            // 限流熔断:记录扩展阶段被限流的源
            if (r.reason instanceof RateLimitError) {
              markRateLimited(name, r.reason.resetAt.getTime());
              if (!rateLimited.includes(name)) rateLimited.push(name);
            }
          }
        }
        for (const r of extFuzzy) {
          if (r.status === 'fulfilled') extRaw.push(...r.value);
          else logError('fallback fuzzy search failed', r.reason);
        }
        if (extRaw.length > 0) {
          // 修复1:扩展结果单独 rank(各自 filter+dedupe+score+sort+slice),
          // 避免对主结果(已 rank 过一次)重新 score/dedupe。
          // 主结果 rankedWithMatch 保持不变,扩展结果独立 collectAndRank 得 extRanked,
          // 合并后只做轻量 dedupe(按 name toLowerCase)+ 一次 sort(按 match.score)。
          const extWheels = extRaw.map(w => enrich(normalize(w)));
          const extRanked = collectAndRank(extWheels, intent, limit, queryKeywords);
          // 跨主+扩展的重复项处理:按 name toLowerCase 轻量 dedupe
          // (两边各自已过 ranker 的完整 dedupe,跨边界重复只可能是同名,如主搜 github 返回 a/b
          //  而扩展搜 gitee 也返回同名 a/b)
          const seen = new Set<string>();
          const merged: Wheel[] = [];
          for (const w of rankedWithMatch) {
            const k = w.name.toLowerCase();
            if (!seen.has(k)) { seen.add(k); merged.push(w); }
          }
          for (const w of extRanked) {
            const k = w.name.toLowerCase();
            if (!seen.has(k)) { seen.add(k); merged.push(w); }
          }
          // 合并后只 sort(按 match.score 降序),不重新 score/dedupe
          // P0-2 修复:fallback expansion 内部不应用 feedback,由主流程(line 257)统一应用一次。
          // 原实现(mergedForSlice = await applyFeedback(merged))会导致 feedback 被应用两次:
          //   1) 这里对 merged 应用一次 → 返回 result.wheels(已含 feedback)
          //   2) 主流程 finalWheels = result.wheels → applyFeedback(finalWheels) 再应用一次
          // 且缓存写入的是 post-feedback wheels(与"存 pre-feedback"注释不一致,污染缓存)。
          // 删除此处 applyFeedback 后:runSearch 返回 pre-feedback → enrich → cache.set(pre-feedback)
          //   → 主流程 applyFeedback 一次,既无 double-apply 也不污染缓存。
          // 注意:放弃了 P2-4 的"slice 前应用 feedback 避免偏好项被截断"优化,
          //   但 double-apply 是更严重的正确性 bug,优先修复。
          merged.sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0));
          rankedWithMatch = merged.slice(0, limit);
        }
        // 无论扩展是否带来新结果,都标记为已扩展(避免下次重复扩展,也避免误报 skippedSources)
        expandedFallback = true;
        // 扩展后即使仍不足,也不再二次扩展(避免无限循环)
      }
    }

    return { wheels: rankedWithMatch, degraded, allFailed: false, routing, expandedFallback, translatedQuery: translated, rateLimited };
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
  const enriched = enrichWithMatch(ranked, queryKeywords);
  // 优化5:applyIntentBoost 在 enrichWithMatch 之后调用(依赖 match.score 调整源权重)。
  // project 意图:GitHub/Gitee/GitLab 加成 ×1.15,包管理器降权 ×0.85;
  // feature 意图:反之。重新按 match.score 降序排序。
  return applyIntentBoost(enriched, intent);
}

/**
 * 优化2+7:不再内联 details 到返回值,所有结果统一用 hasDetails 标记。
 * - top 10 预抓取详情写 detailsCache(供 get_wheel_details 懒加载复用,预热缓存)
 * - top 3 仍抓 README + release(信息完整,缓存里供 get_wheel_details 返回完整信息)
 * - top 4-10 只抓 README(减少 7 个 GitHub API 请求,N16 优化保留)
 * - 所有命中详情的 wheel 统一标记 hasDetails=true,都不内联 details 字段
 */
const TOP_INLINE = 3;   // 优化2+7:不再内联,但 top 3 仍抓 release(信息完整),4-10 只抓 README
const TOP_PREFETCH = 10; // top 10 预抓取写 details 缓存

/**
 * 对排名靠前的 wheels 预抓取详情,实现懒加载呈现:
 * - top 10:预抓取详情写入 detailsCache(AI 调 get_wheel_details 时秒回)
 * - 命中详情的 wheel 标记 hasDetails=true,提示 AI 可调 get_wheel_details 懒加载
 * - 不再把 details 内联到返回值(优化2:避免 limit=8 时返回 12.8KB;优化7:统一 hasDetails 标记)
 *
 * 容错:enrichDetails 失败或返回 null(非 GitHub 源)时,该 wheel 不加任何标记,不影响主流程。
 * 并行抓取 top 10,任一失败不阻断其他。
 */
async function enrichTopWheels(
  wheels: Wheel[],
  enrichOpts: EnrichDetailsOpts,
  detailsCache?: Cache<WheelDetails>,
): Promise<Wheel[]> {
  if (wheels.length === 0) return wheels;
  const prefetchCount = Math.min(TOP_PREFETCH, wheels.length);
  const top = wheels.slice(0, prefetchCount);

  // N16:top 3 抓 README + release(信息完整),top 4-10 只抓 README(减少 7 个 API 请求)
  // 减少约 35% 的 GitHub API 调用(从 20 降到 13),对高频搜索场景有明显改善
  const results = await Promise.allSettled(
    top.map((w, i) => enrichDetails(w, enrichOpts, i < TOP_INLINE)),
  );

  // 不修改入参:用浅拷贝构造新数组,仅对命中详情的元素构造新对象替换
  const enriched: Wheel[] = [...wheels];
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

    // 优化2+7:统一只标记 hasDetails=true,不内联 details(AI 按需调 get_wheel_details 懒加载)
    enriched[i] = { ...enriched[i], hasDetails: true };
  }
  return enriched;
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
 *
 * 优化8:instruction 动态生成,基于 total + degraded 给 AI 不同的提示:
 * - 含降级源时提示"结果可能不完整"
 * - 始终提示"findawheel 不做相关性过滤,自行判断反向意图"
 */
function buildSummary(
  wheels: Wheel[],
  degraded: Array<{ name: string; reason: string }> = [],
): FindWheelOutput['summary'] {
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
    instruction: buildInstruction(totalCount, degraded),
    groups,
    ...(warning ? { warning } : {}),
  };
}

/**
 * 优化8:基于结果数量和降级源动态生成 instruction。
 * - 始终提示"对比 top 5 选 2-3 个,让用户有选择权"
 * - 降级时提示"X 个源降级,结果可能不完整"
 * - 始终提示"findawheel 不做相关性过滤,自行判断反向意图"
 */
function buildInstruction(
  total: number,
  degraded: Array<{ name: string; reason: string }>,
): string {
  const parts: string[] = [`共找到 ${total} 个结果`];

  if (degraded.length > 0) {
    parts.push(`${degraded.length} 个源降级(${degraded.map(d => d.name).join(', ')}),结果可能不完整`);
  }

  parts.push('请对比 top 5 的 stars/lastUpdated/description,选最适合用户场景的 2-3 个推荐给用户,说明选择理由。不要只推荐 1 个,让用户有选择权');
  parts.push('注意:findawheel 不做相关性过滤,请自行判断是否匹配用户意图(特别是反向意图如 add/remove,需识别并跳过)');

  return parts.join('。') + '。';
}

/**
 * 优化6:推断源降级原因。
 * - rate_limited: 该源本次请求触发了 403/429(出现在 rateLimitedSources 列表中)
 * - no_api_key: 该源所需 API key 未配置(librariesio/web 这类必需 key 的源)
 * - error: 其他错误(网络/解析/5xx 等,默认值)
 *
 * 注:github/gitlab/gitee 的 token 是可选的(匿名也可用),缺失不算 no_api_key。
 *     librariesio 缺 key 时适配器返回空(不算 degraded),web 缺 key 时也返回空;
 *     但若适配器实现异常抛错,此分支作为兜底诊断。
 */
function getDegradedReason(name: string, rateLimitedSources: string[] = []): string {
  // 优先:本次请求内被限流(403/429)的源
  if (rateLimitedSources.includes(name)) return 'rate_limited';
  // 次选:必需 API key 的源且未配置
  const requiredApiKeys: Record<string, string[]> = {
    librariesio: ['LIBRARIES_IO_API_KEY'],
    web: ['TAVILY_API_KEY', 'EXA_API_KEY'],
  };
  const envVars = requiredApiKeys[name];
  if (envVars && !envVars.some(v => process.env[v])) return 'no_api_key';
  return 'error';
}
