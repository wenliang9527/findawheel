// src/rank/ranker.ts
// 排序与过滤:基于 stars / recency / activity / 描述匹配度评分。
//
// 设计原则(Phase 6 简化后):
// 只做"召回 + 排序",不做"必命中过滤"。判断相关性交给 AI 调用方,
// AI 看到 top N 结果后自己挑最适合的。硬规则过滤容易误杀主流库。
//
// 删除的机制:
// - isMissingCoreConcept:核心词必命中 → 误杀 description 不含泛词的主流库
// - coreWords/formatWords/antonymExcludes 参数 → 不再需要
//
// 保留的机制(软降权,非硬过滤):
// - isReverseIntent:反向意图检测 → 在 score 阶段 *= 0.3 软降权,
//   避免硬过滤误杀,但仍能让"add watermark" query 不被"remove watermark"结果霸榜

import type { Wheel, Intent } from '../normalize/types.js';
import { GITHUB_CODE_PATH_SEP } from '../normalize/types.js';
import { THREE_YEARS_MS, ONE_YEAR_MS } from '../util/time.js';
import { matchesKeyword, topicMatches } from '../util/keywordMatch.js';

// ===== 排序权重与阈值常量(M7:集中管理,便于调参) =====
// 基础分归一化分母
const STARS_NORMALIZE_MAX = 50000;       // stars 归一化分母:5w stars 视为满分
const DOWNLOADS_NORMALIZE_MAX = 1000000; // downloads 归一化分母:100w 周下载视为满分
// 基础分各信号权重(合计 = 1.0)
const WEIGHT_STARS = 0.25;
const WEIGHT_RECENCY = 0.2;
const WEIGHT_DOWNLOADS = 0.1;
const WEIGHT_LICENSE = 0.05;
const WEIGHT_COVERAGE = 0.4;
// downloads 高量 bonus(超过阈值额外加分,体现"极流行"优势)
const DOWNLOADS_BONUS_THRESHOLD = 100000;
const DOWNLOADS_BONUS = 0.05;
// bonus(query 相关性)合并上限
const BONUS_MAX = 0.5;
// 降权系数
const ZERO_HIT_PENALTY = 0.3;       // 零命中时 stars 降权
const LOW_HIT_RATE_PENALTY = 0.2;   // 命中率<50% 时 stars 降权
const REVERSE_INTENT_PENALTY = 0.3; // 反向意图总分降权
// feature 意图下的权重调整
const FEATURE_STARS_FACTOR = 0.7;
const FEATURE_DOWNLOADS_FACTOR = 1.5;

// ===== 聚合类仓库模式表(集中管理) =====
// 这些是"资源列表",不是具体可用的轮子,在 filterOut 阶段统一剔除。
// 之前分散在 githubSourceAdapter.ts(name 模式)和 ranker.ts(desc 模式)两处,
// 现在合并到 ranker.ts 一处定义,避免模式漂移。
//
// - NAME_PATTERNS:基于 name 的单词匹配(awesome-xxx、public-apis 等)
// - DESC_PATTERNS:基于 description 的短语匹配(awesome list、curated list 等)
const AGGREGATE_NAME_PATTERNS = [
  'awesome', 'public-apis', 'free-for-dev', 'awesome-list',
];
const AGGREGATE_DESC_PATTERNS = [
  'awesome list', 'curated list', 'collection of', 'list of',
  'public apis', 'free for dev', 'resources for',
];

/**
 * 判断是否为聚合类仓库(awesome-xxx、public-apis 等)。
 * 双重检测:name 包含聚合关键词 或 description 包含聚合短语。
 */
function isAggregateRepo(name: string, description: string): boolean {
  const text = `${name} ${description}`.toLowerCase();
  if (AGGREGATE_NAME_PATTERNS.some(p => text.includes(p))) return true;
  const descLower = (description ?? '').toLowerCase();
  return AGGREGATE_DESC_PATTERNS.some(p => descLower.includes(p));
}

/**
 * 反向动词映射:如果 query 含某动词,结果含相反动词则可能是反向意图。
 * 场景:搜 "add watermark" 时,"remove watermark" 工具是反向意图,应降权。
 * 只覆盖常见开发场景动词,避免过度映射误伤。
 */
const REVERSE_VERBS: Record<string, string[]> = {
  'add': ['remove', 'delete', 'strip', 'clear'],
  'remove': ['add', 'insert', 'append'],
  'install': ['uninstall', 'remove'],
  'uninstall': ['install'],
  'create': ['destroy', 'delete'],
  'delete': ['create'],
  'encrypt': ['decrypt'],
  'decrypt': ['encrypt'],
  'enable': ['disable'],
  'disable': ['enable'],
  'start': ['stop', 'kill'],
  'stop': ['start'],
};

/**
 * 检测反向意图:如果 query 含"add",description 含"remove"等反向动词,返回 true。
 * 仅当 query 关键词命中 REVERSE_VERBS 的 key 时才触发检测,
 * 避免对普通关键词(如 image/watermark)产生误判。
 *
 * 优化12:新增 "X to Y" 反向检测(见 isReverseToIntent),覆盖
 * "html to pdf" 搜出 "Convert PDF to HTML" 这类反向场景。
 */
function isReverseIntent(queryKeywords: string[], description: string, query: string = ''): boolean {
  if (!description) return false;
  const descLower = description.toLowerCase();
  if (queryKeywords.length > 0) {
    for (const kw of queryKeywords) {
      const reverse = REVERSE_VERBS[kw.toLowerCase()];
      if (reverse) {
        for (const r of reverse) {
          if (descLower.includes(r)) return true;
        }
      }
    }
  }
  // 优化12:X to Y 反向检测(用户要 "html to pdf",结果含 "pdf to html" 则反向)
  if (query && isReverseToIntent(query, description)) return true;
  return false;
}

/**
 * 检测 "X to Y" vs "Y to X" 的反向意图。
 * 用户搜 "html to pdf",结果描述含 "pdf to html" / "pdf2html" / "pdf→html" 则是反向。
 * 仅当 query 含明确的 "X to Y" 模式时才触发,避免误判普通 "to" 介词。
 */
function isReverseToIntent(query: string, description: string): boolean {
  const queryToMatch = query.match(/(\w+)\s+to\s+(\w+)/i);
  if (!queryToMatch) return false;
  const [, from, to] = queryToMatch;
  // description 含 "Y to X" / "Y2X" / "Y→X" 即视为反向
  const reversePattern = new RegExp(`\\b${to}\\s*(?:to|2|→)\\s*${from}\\b`, 'i');
  return reversePattern.test(description);
}

/**
 * 基础过滤:剔除明显不可用的结果。
 * - archived 仓库
 * - 超过 3 年未更新
 * - 无描述且无任何热度信号(stars/downloads/lastUpdated 都缺)
 * - 聚合类仓库(awesome-xxx、public-apis 等)
 * - TypeScript 类型定义包(@types/*)——不是运行时库,
 *   且 npm registry 的 stars 数据常从主包复制(假数据),不应作为主推荐
 *
 * 注:时间取值用 Date.now() 调用时取值,不用模块级常量 ——
 * MCP server 是长期运行的 stdio 进程,模块加载时固定的 NOW 会随运行时间漂移。
 *
 * N7 修复:原规则 `(!description && stars < 10)` 会误杀 Maven/Gopkg 等无 stars 数据的源
 * (Maven description 常为空,stars undefined → 0 < 10 → 被过滤)。
 * 改为:无描述时,只有当 stars/downloads/lastUpdated 三个热度信号都缺失才过滤。
 *
 * P1-2 修复:PyPI 源豁免上述"无描述+无热度信号"规则。PyPI normalizer 只在 enrich
 * 成功时设 stars,不设 lastUpdated/downloads(HTML 搜索 API 不返回这些字段),
 * 导致无描述且 enrich 失败(无 githubToken 或非 GitHub 项目)的 PyPI 包被静默误杀。
 */
export function filterOut(wheel: Wheel): boolean {
  const m = wheel.metrics;
  if (m.archived === true) return true;
  if (m.lastUpdated) {
    const t = Date.parse(m.lastUpdated);
    if (!Number.isNaN(t) && Date.now() - t > THREE_YEARS_MS) return true;
  }
  // N7:无描述时,只有当所有热度信号都缺失才过滤(避免误杀 Maven/Gopkg 等无 stars 的源)
  if (!wheel.description || wheel.description.trim() === '') {
    // P1-2:PyPI 源豁免——PyPI normalizer 只在 enrich 成功时设 stars,
    // 不设 lastUpdated/downloads(HTML 搜索 API 不返回上传时间/下载量),
    // 导致无描述且 enrich 失败(无 githubToken 或非 GitHub 项目)的包被静默误杀。
    // 与 Maven/Gopkg 同理:PyPI 搜索结果本身已通过 PyPI 排序,默认信任。
    if (wheel.source !== 'pypi') {
      const hasStars = (m.stars ?? 0) >= 10;
      const hasDownloads = (m.downloads ?? 0) >= 100;
      const hasLastUpdated = Boolean(m.lastUpdated);
      if (!hasStars && !hasDownloads && !hasLastUpdated) return true;
    }
  }

  // 过滤聚合类仓库(awesome-xxx、public-apis 等)
  if (isAggregateRepo(wheel.name, wheel.description)) return true;

  // 过滤 TypeScript 类型定义包(@types/*):不是运行时库,
  // 且 npm registry 的 stars 数据常从主包复制(不可靠,如 @types/html-pdf-node stars=51352 与主包一致)。
  // 类型定义包对用户选库决策没有帮助,直接剔除。
  if (wheel.name.startsWith('@types/')) return true;

  return false;
}

// matchesKeyword 和 topicMatches 已移到 src/util/keywordMatch.ts 共享模块

/**
 * 描述匹配加分:检查 description 是否包含 query 的核心关键词。
 * 真正相关的项目描述里通常会包含 query 的关键词,
 * 而靠 README 关键词堆砌匹配上的项目描述里往往没有。
 */
function descriptionMatchBonus(wheel: Wheel, queryKeywords: string[]): number {
  if (!wheel.description || queryKeywords.length === 0) return 0;
  const descLower = wheel.description.toLowerCase();
  const hitCount = queryKeywords.filter(kw => matchesKeyword(descLower, kw.toLowerCase())).length;
  // 命中率 × 0.15 加分(最多加 0.15)
  return Math.min(hitCount / Math.max(queryKeywords.length, 1), 1) * 0.15;
}

/**
 * R2:name 命中权重高于 description。
 * 场景:搜 "lodash" 时,name=lodash/lodash 的项目比 description 含 "lodash" 的更相关。
 * 给 name 命中额外加 0.1 分。
 */
function nameMatchBonus(wheel: Wheel, queryKeywords: string[]): number {
  if (!wheel.name || queryKeywords.length === 0) return 0;
  const nameLower = wheel.name.toLowerCase();
  const hitCount = queryKeywords.filter(kw => matchesKeyword(nameLower, kw.toLowerCase())).length;
  if (hitCount === 0) return 0;
  // name 命中至少 1 个关键词就加 0.1,全部命中加 0.15
  return Math.min(0.1 + (hitCount / queryKeywords.length) * 0.05, 0.15);
}

/**
 * R3:精确短语匹配加分。
 * 场景:description 含完整 query 短语(如 "markdown editor" 连续出现)比单词散落命中更相关。
 * 需要 queryKeywords 长度 >= 2 才触发。
 */
function phraseMatchBonus(wheel: Wheel, queryKeywords: string[]): number {
  if (!wheel.description || queryKeywords.length < 2) return 0;
  const descLower = wheel.description.toLowerCase();
  // 检查 query 关键词是否在 description 里连续出现(顺序无关,但需紧邻)
  const phrase = queryKeywords.slice(0, 3).join(' ').toLowerCase();
  const reversedPhrase = queryKeywords.slice(0, 3).reverse().join(' ').toLowerCase();
  if (descLower.includes(phrase) || descLower.includes(reversedPhrase)) {
    return 0.1; // 精确短语命中加 0.1
  }
  return 0;
}

/**
 * R1:topics 命中加分。
 * 场景:GitHub topics 是仓库作者主动打的标签,命中 query 词说明项目核心主题匹配。
 * 例:搜 "stepper motor" 时,topics 含 "stepper-motor" 的项目加 0.1 分。
 *
 * N8:短关键词(≤3 字符)用子串匹配会误匹配,改用 topicMatches helper。
 */
function topicsMatchBonus(wheel: Wheel, queryKeywords: string[]): number {
  if (!wheel.topics || wheel.topics.length === 0 || queryKeywords.length === 0) return 0;
  const topicsLower = wheel.topics.map(t => t.toLowerCase());
  let hitCount = 0;
  for (const kw of queryKeywords) {
    const kwLower = kw.toLowerCase();
    // N8:短关键词用精确/边界匹配,长关键词用子串匹配
    if (topicsLower.some(t => topicMatches(t, kwLower))) {
      hitCount++;
    }
  }
  if (hitCount === 0) return 0;
  // topics 命中加 0.05~0.1(至少 1 个加 0.05,全部命中加 0.1)
  return Math.min(0.05 + (hitCount / queryKeywords.length) * 0.05, 0.1);
}

// topicMatches 已移到 src/util/keywordMatch.ts 共享模块

/**
 * 计算 query 全词覆盖率:description/name 命中 query 所有实义词的比例。
 * 用于排序:覆盖率越高,项目越可能是真正相关的。
 * voicebox/crawl4ai 这种覆盖率=0 的项目,即使 star 再高也不该排前面。
 */
function queryCoverage(wheel: Wheel, queryKeywords: string[]): number {
  if (queryKeywords.length === 0) return 0;
  const text = `${wheel.name} ${wheel.description}`.toLowerCase();
  const hitCount = queryKeywords.filter(kw => matchesKeyword(text, kw.toLowerCase())).length;
  return hitCount / queryKeywords.length;
}

/**
 * 判断是否"零命中":description/name 一个 query 关键词都不含。
 * 用于高 star 降权:零命中的高 star 项目(如 voicebox)不应霸榜。
 */
function isZeroHit(wheel: Wheel, queryKeywords: string[]): boolean {
  if (queryKeywords.length === 0) return false;
  const text = `${wheel.name} ${wheel.description}`.toLowerCase();
  return !queryKeywords.some(kw => matchesKeyword(text, kw.toLowerCase()));
}

/**
 * 低命中率检测:query 关键词命中率 < 50% 时返回 true。
 * 场景:用户搜 "html to pdf"(4 个关键词),apify/crawlee 只命中 "html"(1/4=25%),
 * 即使 stars=24821 也不应靠 star 霸榜。
 * 与 isZeroHit 的区别:isZeroHit 是 0% 命中,isLowHitRate 是 < 50% 命中(更宽松)。
 */
function isLowHitRate(wheel: Wheel, queryKeywords: string[]): boolean {
  if (queryKeywords.length === 0) return false;
  const desc = (wheel.description || '').toLowerCase();
  const name = wheel.name.toLowerCase();
  let hitCount = 0;
  for (const kw of queryKeywords) {
    const kwLower = kw.toLowerCase();
    if (desc.includes(kwLower) || name.includes(kwLower)) {
      hitCount++;
    }
  }
  return hitCount / queryKeywords.length < 0.5;
}

function normalize(v: number | undefined, max: number): number {
  if (v === undefined || v <= 0) return 0;
  return Math.min(v / max, 1);
}

function recencyScore(lastUpdated?: string): number {
  if (!lastUpdated) return 0;
  const t = Date.parse(lastUpdated);
  if (Number.isNaN(t)) return 0;
  const ageMs = Date.now() - t;
  // R5:连续衰减函数(替代阶梯式),避免边界跳跃
  // 公式:1 年内 = 1.0,1-3 年线性衰减到 0.1,3 年以上 = 0
  if (ageMs <= ONE_YEAR_MS) return 1.0;
  if (ageMs <= 3 * ONE_YEAR_MS) {
    // 1-3 年线性衰减:1.0 → 0.1
    const progress = (ageMs - ONE_YEAR_MS) / (2 * ONE_YEAR_MS); // 0~1
    return 1.0 - progress * 0.9; // 1.0 → 0.1
  }
  return 0;
}

// 注:activityScore 已删除(P0-3 合并重复计分)。
// 原本 activity 和 recency 都基于 lastUpdated,存在重复计分。
// 现在统一用 recency 的连续衰减函数,不再需要 activity 的阶梯式映射。

export function score(wheel: Wheel, intent: Intent, queryKeywords: string[] = [], query: string = ''): number {
  const m = wheel.metrics;

  // ===== P0-2:基础分(归一化到 1.0)+ bonus(上限 0.5)结构 =====
  // 基础分:项目质量与活跃度信号,各项相加 = 1.0
  //   stars 0.25 + recency 0.2 + coverage 0.4 + downloads 0.1 + license 0.05
  //   + downloads bonus 0.05(高 downloads 包,>100k 时触发,cap 0.15)
  //   即基础分上限 = 1.05(downloads 满分场景下)
  // bonus:query 相关性加分,独立叠加,合并上限 0.5
  //   descBonus(0.15)+ nameBonus(0.15)+ phraseBonus(0.1)+ topicsBonus(0.1)

  let stars = normalize(m.stars, STARS_NORMALIZE_MAX) * WEIGHT_STARS;
  const recency = recencyScore(m.lastUpdated) * WEIGHT_RECENCY;
  // R4:downloads 分母从 100000 提到 1000000(覆盖百万级周下载量包)
  let downloads = normalize(m.downloads, DOWNLOADS_NORMALIZE_MAX) * WEIGHT_DOWNLOADS;
  // 优化18:高 downloads bonus —— 超过 100k downloads 的包加额外 0.05 分(cap 0.15)。
  // 场景:npm 包 downloads 达百万级时,normalize 后已是 0.1 满分,无法体现"极流行"优势;
  // 加 0.05 bonus 让 100k+ 包在排序里略胜 50k 包,避免中量级包与极流行包同分。
  // 系数保守(0.05),避免 npm 包刷分压制 GitHub 项目。
  if (m.downloads && m.downloads > DOWNLOADS_BONUS_THRESHOLD) {
    downloads += DOWNLOADS_BONUS;  // 额外 bonus,downloads 总上限 0.15
  }
  const license = m.license ? WEIGHT_LICENSE : 0;
  // coverage 是基础分里的相关性信号(描述全词覆盖率)
  const coverage = queryCoverage(wheel, queryKeywords) * WEIGHT_COVERAGE;

  // bonus 加分项(query 相关性,独立于基础分,合并上限 0.5)
  const descBonus = descriptionMatchBonus(wheel, queryKeywords);    // 上限 0.15
  const nameBonus = nameMatchBonus(wheel, queryKeywords);            // 上限 0.15
  const phraseBonus = phraseMatchBonus(wheel, queryKeywords);        // 上限 0.1
  const topicsBonus = topicsMatchBonus(wheel, queryKeywords);        // 上限 0.1
  const bonusTotal = Math.min(
    descBonus + nameBonus + phraseBonus + topicsBonus,
    BONUS_MAX, // P0-2:bonus 统一上限 0.5
  );

  // 高 star 零命中降权:如果一个 query 关键词都不命中,stars 权重砍半
  // 场景:voicebox(⭐37k)搜 "AI coding monitor" 时零命中,不应靠 star 霸榜
  if (isZeroHit(wheel, queryKeywords)) {
    stars *= ZERO_HIT_PENALTY;
  }
  // 优化20:低命中率降权 — 命中率 < 50% 时,stars 权重 *0.2(强降权)
  // 场景:apify/crawlee(24821★)搜 "html to pdf" 只命中 1/4,不应靠 star 霸榜
  // 系数从 0.5 调整为 0.2:测试发现 0.5 仍让 crawlee 排第一,需要更强降权
  if (isLowHitRate(wheel, queryKeywords)) {
    stars *= LOW_HIT_RATE_PENALTY;
  }

  if (intent === 'feature') {
    stars *= FEATURE_STARS_FACTOR;
    downloads *= FEATURE_DOWNLOADS_FACTOR;
  }

  // 总分 = 基础分(<=1.0)+ bonus(<=0.5),上限 1.5
  let total = stars + recency + coverage + downloads + license + bonusTotal;
  // 反向意图软降权:query 含"add",description 含"remove"等反向动词时,score *= 0.3
  // 软降权(非硬过滤),避免"add watermark"被"remove watermark"结果霸榜,
  // 同时保留 AI 调用方对边界情况的判断空间(结果仍出现在候选列表,只是排位靠后)。
  if (wheel.description && isReverseIntent(queryKeywords, wheel.description, query)) {
    total *= REVERSE_INTENT_PENALTY;
  }
  return total;
}

export function dedupe(wheels: Wheel[]): Wheel[] {
  // N3:github-code 的 name 是 "owner/repo#path",与 github 的 "owner/repo" 不同,
  // 但实际指向同一仓库。如果同仓库已有 github 仓库级结果,丢弃 github-code 文件级结果
  // (仓库级结果 description/topics 更完整,对 AI 更有价值)。
  // github-code 之间也会去重(同仓库多个文件只保留第一个,通常是 stars 最高/最近更新的)。
  const githubRepos = new Set<string>();
  // 先扫一遍:收集 github 仓库级结果占据的 owner/repo
  for (const w of wheels) {
    if (w.source === 'github') {
      githubRepos.add(w.name.toLowerCase());
    }
  }
  const map = new Map<string, Wheel>();
  for (const w of wheels) {
    let key: string;
    if (w.source === 'github-code') {
      // github-code name = "owner/repo#path",取 owner/repo 部分作为 dedupe key
      const repo = w.name.split(GITHUB_CODE_PATH_SEP)[0].toLowerCase();
      key = `gh-code:${repo}`;  // 用前缀避免与 github 仓库级结果冲突
      // N3:同仓库已有 github 仓库级结果 → 丢弃 github-code 文件级结果
      if (githubRepos.has(repo)) continue;
    } else {
      key = w.name.toLowerCase();
    }
    const existing = map.get(key);
    if (!existing) {
      map.set(key, w);
      continue;
    }
    // P1-6:合并 topics(场景:GitHub 项目 + npm 包同名,
    // 前者有 topics,后者有 keywords 归一化为 topics)。合并后提升 topicsMatchBonus 准确性。
    const mergedTopics = mergeTopics(existing.topics, w.topics);

    // Merge: keep richer metrics (more defined fields)
    const wScore = Object.values(w.metrics).filter(v => v !== undefined).length;
    const eScore = Object.values(existing.metrics).filter(v => v !== undefined).length;
    // 统一不可变风格:两条分支都用 map.set 构造新对象,避免原地修改 existing 污染外部引用
    const base = wScore > eScore ? w : existing;
    map.set(key, { ...base, topics: mergedTopics });
  }
  return [...map.values()];
}

/** 合并两个 topics 数组(去重,保持顺序) */
function mergeTopics(a?: string[], b?: string[]): string[] | undefined {
  if (!a || a.length === 0) return b && b.length > 0 ? [...b] : a;
  if (!b || b.length === 0) return a;
  const set = new Set(a.map(t => t.toLowerCase()));
  const merged = [...a];
  for (const t of b) {
    if (!set.has(t.toLowerCase())) {
      merged.push(t);
      set.add(t.toLowerCase());
    }
  }
  return merged;
}

/**
 * 排序:基础过滤 + 去重 + 评分排序 + 多样性惩罚 + 截断。
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
  query: string = '',
): Wheel[] {
  const filtered = wheels.filter(w => !filterOut(w));
  const deduped = dedupe(filtered);
  const scored = deduped
    .map(w => ({ w, s: score(w, intent, queryKeywords, query) }))
    .sort((a, b) => b.s - a.s);
  // P1-1:同源多样性惩罚(连续 4+ 同源后,第 4 次起 score*=0.9),避免单一源霸榜
  const diversified = applySourceDiversity(scored);
  return diversified.slice(0, limit).map(x => x.w);
}

/**
 * 多样性惩罚:同源连续 3 次后,第 4 次起 score*=0.9。
 * 避免单一源(如 GitHub)霸榜 top 结果。
 *
 * 实现说明:在 rank 内部基于已计算的 score(`s` 字段)惩罚,不依赖 match.score
 * (rank 阶段还未 enrichWithMatch,match 字段尚未填充)。
 * 不 mutate 原数组,返回新数组;惩罚后重新按 score 降序排序。
 *
 * project_memory.md 记录:"Source diversity is enforced in results with penalty
 * for 4+ consecutive same-source entries (score*=0.9)"。
 */
function applySourceDiversity(scored: { w: Wheel; s: number }[]): { w: Wheel; s: number }[] {
  if (scored.length < 4) return scored;
  const result = [...scored];  // 不 mutate 原数组
  let consecutiveCount = 1;
  for (let i = 1; i < result.length; i++) {
    if (result[i].w.source === result[i - 1].w.source) {
      consecutiveCount++;
      if (consecutiveCount >= 4) {
        // 第 4 次起(含)惩罚
        result[i] = { ...result[i], s: result[i].s * 0.9 };
      }
    } else {
      consecutiveCount = 1;
    }
  }
  // 重新排序(惩罚后顺序可能变化)
  result.sort((a, b) => b.s - a.s);
  return result;
}

/**
 * 优化5:intent 感知的源权重调整。
 *
 * 问题:用户传 intent="project" 时,期望优先看到 GitHub/Gitee/GitLab 完整项目,
 * 但默认排序里 npm/crates/PyPI 包(因 downloads 高)经常压过 GitHub 项目。
 *
 * 规则:
 * - project 意图:GitHub/Gitee/GitLab 仓库级 source 加成 ×1.15,
 *   包管理器(npm/crates/pypi/rubygems/maven/gopkg)降权 ×0.85。
 *   其他源(web/github-code/librariesio/paperswithcode/huggingface/vscode-marketplace)不变。
 * - feature 意图:包管理器(npm/crates/pypi/rubygems/maven/gopkg)加成 ×1.15,
 *   GitHub/Gitee/GitLab 仓库级按 stars 分级处理:
 *   - 高 stars(>1000):不降权(保留 1.0),让流行 GitHub 库仍能出现在 feature 结果里
 *   - 低 stars(≤1000):降权 ×0.85,避免低质量 GitHub 项目压制包管理器结果
 *   feature 通常对应"某个功能用什么库实现",包管理器结果(含版本/下载量)更直接,
 *   但高 stars GitHub 项目(如 5k+ stars 流行库)本身也是可靠的 feature 候选。
 *
 * 实现说明:作用于 enrichWithMatch 之后的 wheels(match.score 已填充),
 * 调整 match.score 并重新降序排序。不 mutate 原数组,返回新数组。
 *
 * 不改 sourceRouter.ts:router 决定"搜哪些源",applyIntentBoost 决定"已搜到的怎么排序",
 * 两者职责正交。即使 project 意图下包管理器源被路由选中(场景:npm 上有同名包),
 * 这里通过 score 降权让 GitHub 项目排前面。
 */
export function applyIntentBoost(wheels: Wheel[], intent: Intent): Wheel[] {
  if (wheels.length === 0) return wheels;

  // 包管理器源集合(feature 意图加成,project 意图降权)
  const PACKAGE_SOURCES = new Set(['npm', 'crates', 'pypi', 'rubygems', 'maven', 'gopkg']);
  // 仓库源集合(project 意图加成,feature 意图降权)
  const REPO_SOURCES = new Set(['github', 'gitee', 'gitlab']);

  // 优化19:feature 意图下高 stars 仓库源的阈值,超过此值不降权
  const FEATURE_REPO_HIGH_STARS_THRESHOLD = 1000;

  const boosted = wheels.map(w => {
    let factor = 1.0;
    if (intent === 'project') {
      if (REPO_SOURCES.has(w.source)) {
        factor = 1.15;
      } else if (PACKAGE_SOURCES.has(w.source)) {
        factor = 0.85;
      }
    } else if (intent === 'feature') {
      if (PACKAGE_SOURCES.has(w.source)) {
        factor = 1.15;
      } else if (REPO_SOURCES.has(w.source)) {
        // 优化19:高 stars GitHub/Gitee/GitLab 项目不降权(流行库也是 feature 候选)
        const stars = w.metrics.stars ?? 0;
        factor = stars > FEATURE_REPO_HIGH_STARS_THRESHOLD ? 1.0 : 0.85;
      }
    } else {
      return w;  // 兜底:未知 intent 不调整
    }
    if (factor === 1.0 || !w.match) return w;
    return {
      ...w,
      match: { ...w.match, score: w.match.score * factor },
    };
  });

  // 重新按 match.score 降序排序(boost 后顺序可能变化)
  boosted.sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0));
  return boosted;
}
