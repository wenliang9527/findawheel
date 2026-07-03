// src/rank/ranker.ts
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

/**
 * 核心词必命中过滤:结果的 description 或 name 必须包含至少一个核心动作词。
 *
 * 场景:用户搜 "invisible image watermark encryption resistant cropping",
 * 核心动作词是 watermark/encrypt,但裁剪工具 react-image-crop 的 description
 * 里既没 watermark 也没 encrypt —— 这类结果应该被剔除。
 *
 * 格式词检查:如果 query 里有格式词(pdf/word/ppt/excel 等),
 * 结果的 description/name 也必须命中至少一个格式词。
 * 场景:搜 "pdf to markdown" 却返回 HTML 转换器 —— 剔除。
 *
 * 注意:仅当核心词/格式词存在时才过滤;都没有时跳过本规则。
 *
 * @param coreWords query 的核心词(动作词优先),来自 queryParser
 * @param formatWords query 里出现的格式词,来自 queryParser
 */
export function isMissingCoreConcept(
  wheel: Wheel,
  coreWords: string[] = [],
  formatWords: string[] = [],
): boolean {
  // 包名/仓库名也算"描述"的一部分,避免描述简短但包名精准的工具被误杀
  const text = `${wheel.name} ${wheel.description}`.toLowerCase();
  // 核心词:至少命中一个(如果有的话)
  if (coreWords.length > 0 && !coreWords.some(w => text.includes(w.toLowerCase()))) {
    return true;
  }
  // 格式词:如果 query 里有格式词,结果也必须命中至少一个
  if (formatWords.length > 0 && !formatWords.some(w => text.includes(w.toLowerCase()))) {
    return true;
  }
  return false;
}

/**
 * 反向意图过滤:检查结果是否是用户想要的"反向动作"。
 * 例:用户搜 watermark(想加水印),但结果是 "remove watermark" / "watermark remover"。
 *
 * 判定规则:antonymExcludes 里的词 + query 核心动作词 同时出现在 description 里 → 剔除。
 * 如 query 含 "watermark",antonymExcludes 含 "remove",
 * 结果描述含 "remove watermark" 或 "watermark remover" → 剔除。
 *
 * @param antonymExcludes 反义词列表(来自 queryParser)
 * @param queryKeywords query 关键词(用于检测反向动作是否针对同一对象)
 */
export function isReverseIntent(
  wheel: Wheel,
  antonymExcludes: string[],
  queryKeywords: string[] = [],
): boolean {
  if (antonymExcludes.length === 0 || !wheel.description) return false;
  const descLower = wheel.description.toLowerCase();
  // 描述里必须同时出现"反向动词"和"动作对象"才判定为反向意图
  // 例:"remove watermark" 同时含 remove 和 watermark → 反向
  //     "remove files" 含 remove 但不含 watermark → 不是针对 watermark 的反向,保留
  const hasAntonym = antonymExcludes.some(w => descLower.includes(w));
  if (!hasAntonym) return false;
  // 检查描述是否同时包含 query 的核心动作词(说明反向动作是针对同一对象)
  const actionWords = queryKeywords.filter(kw =>
    ANTONYM_ACTION_WORDS.has(kw.toLowerCase())
  );
  if (actionWords.length === 0) return false;
  return actionWords.some(w => descLower.includes(w.toLowerCase()));
}

// 触发反义词检测的动作词(与 queryParser 的 ANTONYMS 表对应)
const ANTONYM_ACTION_WORDS = new Set(['watermark', 'encrypt']);

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

export function rank(
  wheels: Wheel[],
  intent: Intent,
  limit: number,
  queryKeywords: string[] = [],
  antonymExcludes: string[] = [],
  coreWords: string[] = [],
  formatWords: string[] = [],
): Wheel[] {
  const filtered = wheels.filter(w =>
    !filterOut(w)
    && !isReverseIntent(w, antonymExcludes, queryKeywords)
    && !isMissingCoreConcept(w, coreWords, formatWords)
  );
  const deduped = dedupe(filtered);
  const scored = deduped
    .map(w => ({ w, s: score(w, intent, queryKeywords) }))
    .sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map(x => x.w);
}
