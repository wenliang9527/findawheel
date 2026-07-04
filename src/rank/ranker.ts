// src/rank/ranker.ts
// 排序与过滤:基于 stars / recency / activity / 描述匹配度评分。
//
// 设计原则(Phase 6 简化后):
// 只做"召回 + 排序",不做"必命中过滤"。判断相关性交给 AI 调用方,
// AI 看到 top N 结果后自己挑最适合的。硬规则过滤容易误杀主流库。
//
// 删除的机制:
// - isMissingCoreConcept:核心词必命中 → 误杀 description 不含泛词的主流库
// - isReverseIntent:反义词过滤 → AI 完全可以自己识别"remove watermark"
// - coreWords/formatWords/antonymExcludes 参数 → 不再需要

import type { Wheel, Intent, WheelMetrics } from '../normalize/types.js';
import { isAggregateRepo } from '../sources/githubSourceAdapter.js';

const THREE_YEARS_MS = 3 * 365 * 24 * 3600 * 1000;
const NOW = Date.now();

// 聚合类仓库关键词(awesome-xxx、public-apis、free-for-dev 等)
// 这些是"资源列表",不是具体可用的轮子
const AGGREGATE_DESC_PATTERNS = [
  'awesome list', 'curated list', 'collection of', 'list of',
  'public apis', 'free for dev', 'resources for',
];

/**
 * 基础过滤:剔除明显不可用的结果。
 * - archived 仓库
 * - 超过 3 年未更新
 * - 无描述且 stars < 10
 * - 聚合类仓库(awesome-xxx、public-apis 等)
 */
export function filterOut(wheel: Wheel): boolean {
  const m = wheel.metrics;
  if (m.archived === true) return true;
  if (m.lastUpdated) {
    const t = Date.parse(m.lastUpdated);
    if (!Number.isNaN(t) && NOW - t > THREE_YEARS_MS) return true;
  }
  if ((!wheel.description || wheel.description.trim() === '') && (m.stars ?? 0) < 10) return true;

  // 过滤聚合类仓库(awesome-xxx、public-apis 等)
  if (isAggregateRepo(wheel.name, wheel.description)) return true;
  const descLower = wheel.description.toLowerCase();
  if (AGGREGATE_DESC_PATTERNS.some(p => descLower.includes(p))) return true;

  return false;
}

/**
 * 描述匹配加分:检查 description 是否包含 query 的核心关键词。
 * 真正相关的项目描述里通常会包含 query 的关键词,
 * 而靠 README 关键词堆砌匹配上的项目描述里往往没有。
 */
function descriptionMatchBonus(wheel: Wheel, queryKeywords: string[]): number {
  if (!wheel.description || queryKeywords.length === 0) return 0;
  const descLower = wheel.description.toLowerCase();
  const hitCount = queryKeywords.filter(kw => descLower.includes(kw.toLowerCase())).length;
  // 命中率 × 0.15 加分(最多加 0.15)
  return Math.min(hitCount / Math.max(queryKeywords.length, 1), 1) * 0.15;
}

/**
 * 计算 query 全词覆盖率:description/name 命中 query 所有实义词的比例。
 * 用于排序:覆盖率越高,项目越可能是真正相关的。
 * voicebox/crawl4ai 这种覆盖率=0 的项目,即使 star 再高也不该排前面。
 */
function queryCoverage(wheel: Wheel, queryKeywords: string[]): number {
  if (queryKeywords.length === 0) return 0;
  const text = `${wheel.name} ${wheel.description}`.toLowerCase();
  const hitCount = queryKeywords.filter(kw => text.includes(kw.toLowerCase())).length;
  return hitCount / queryKeywords.length;
}

/**
 * 判断是否"零命中":description/name 一个 query 关键词都不含。
 * 用于高 star 降权:零命中的高 star 项目(如 voicebox)不应霸榜。
 */
function isZeroHit(wheel: Wheel, queryKeywords: string[]): boolean {
  if (queryKeywords.length === 0) return false;
  const text = `${wheel.name} ${wheel.description}`.toLowerCase();
  return !queryKeywords.some(kw => text.includes(kw.toLowerCase()));
}

function normalize(v: number | undefined, max: number): number {
  if (v === undefined || v <= 0) return 0;
  return Math.min(v / max, 1);
}

function recencyScore(lastUpdated?: string): number {
  if (!lastUpdated) return 0;
  const t = Date.parse(lastUpdated);
  if (Number.isNaN(t)) return 0;
  const ageMs = NOW - t;
  const oneYear = 365 * 24 * 3600 * 1000;
  if (ageMs <= oneYear) return 1.0;
  if (ageMs <= 2 * oneYear) return 0.7;
  if (ageMs <= 3 * oneYear) return 0.4;
  return 0;
}

function activityScore(activity?: WheelMetrics['activity']): number {
  switch (activity) {
    case 'high': return 1.0;
    case 'medium': return 0.5;
    case 'low': return 0.2;
    default: return 0;
  }
}

export function score(wheel: Wheel, intent: Intent, queryKeywords: string[] = []): number {
  const m = wheel.metrics;
  let stars = normalize(m.stars, 50000) * 0.3;
  const recency = recencyScore(m.lastUpdated) * 0.3;
  const activity = activityScore(m.activity) * 0.2;
  let downloads = normalize(m.downloads, 100000) * 0.1;
  const license = m.license ? 0.1 : 0;
  // 描述匹配加分:描述命中 query 核心词的项目更可能是真正相关的轮子
  const descBonus = descriptionMatchBonus(wheel, queryKeywords);
  // 全词覆盖率打分:description 命中 query 所有实义词的比例(0~0.2)
  // 覆盖率高的项目更可能真正相关,voicebox/crawl4ai 覆盖率=0 自然排后面
  const coverage = queryCoverage(wheel, queryKeywords) * 0.2;

  // 高 star 零命中降权:如果一个 query 关键词都不命中,stars 权重砍半
  // 场景:voicebox(⭐37k)搜 "AI coding monitor" 时零命中,不应靠 star 霸榜
  if (isZeroHit(wheel, queryKeywords)) {
    stars *= 0.3;
  }

  if (intent === 'feature') {
    stars *= 0.7;
    downloads *= 1.5;
  }
  return stars + recency + activity + downloads + license + descBonus + coverage;
}

export function dedupe(wheels: Wheel[]): Wheel[] {
  const map = new Map<string, Wheel>();
  for (const w of wheels) {
    const key = w.name.toLowerCase();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, w);
      continue;
    }
    // Merge: keep richer metrics (more defined fields)
    const wScore = Object.values(w.metrics).filter(v => v !== undefined).length;
    const eScore = Object.values(existing.metrics).filter(v => v !== undefined).length;
    if (wScore > eScore) map.set(key, w);
  }
  return [...map.values()];
}

/**
 * 排序:基础过滤 + 去重 + 评分排序 + 截断。
 *
 * 简化后只做"召回 + 排序",不做"必命中过滤"。
 * 相关性判断交给 AI 调用方 —— AI 看到 top N 结果后自己挑最适合的。
 *
 * @param queryKeywords query 关键词,用于描述匹配加分和覆盖率计算
 */
export function rank(
  wheels: Wheel[],
  intent: Intent,
  limit: number,
  queryKeywords: string[] = [],
): Wheel[] {
  const filtered = wheels.filter(w => !filterOut(w));
  const deduped = dedupe(filtered);
  const scored = deduped
    .map(w => ({ w, s: score(w, intent, queryKeywords) }))
    .sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map(x => x.w);
}
