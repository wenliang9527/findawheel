// src/classifier/sourceRouter.ts
// 智能数据源路由:根据 query 类型选择合适的数据源子集,跳过明显不相关的源。
//
// 目的:
// - 节省 API 配额(GitHub 10 req/min、Gitee 60 req/hour、Libraries.io/Exa/Tavily 等)
// - 减少 token 消耗(相关源返回更聚焦的结果)
// - 提升结果精度(避免不相关源的噪声稀释)
//
// 策略(方案 B:智能路由 + 兜底扩展):
// 1. 强信号匹配 → 只搜选中源
// 2. 无匹配 → 全搜(保持现有行为,向后兼容)
// 3. 兜底:召回不足(top 1 stars < 10 或结果 < 5 条)→ 自动扩展到全源重搜
//
// 优先级:用户显式传 ecosystem > parseQuery 识别 > 关键词检测 > 兜底全搜

import type { Intent } from '../normalize/types.js';
import type { ParsedQuery } from './queryParser.js';
import { isHardwareQuery } from './hardwareKeywords.js';

/** 所有可用的数据源名(与 server.ts 中注册的 adapter.name 一一对应) */
export const ALL_SOURCES = [
  'github',
  'gitee',
  'gitlab',
  'registry',           // npm
  'pypi',
  'librariesio',
  'github-code',
  'vscode-marketplace',
  'paperswithcode',
  'huggingface',
  'web',
  'maven',              // Java/Kotlin
  'rubygems',           // Ruby
  'gopkg',              // Go modules
] as const;

/** 路由上下文 —— 把判断需要的字段打包,避免函数签名爆炸 */
export interface RoutingContext {
  /** 用户原始 query */
  query: string;
  /** 翻译后的英文 query(用于关键词检测,中文 query 翻译后才能匹配英文关键词) */
  translatedQuery: string;
  /** ecosystem 参数(AI 显式传或 parseQuery 识别) */
  ecosystem?: string;
  /** 意图(feature/project) */
  intent: Intent;
  /** parseQuery 解析结果(corePhrase/coreWords/modifiers 等) */
  parsedQuery: ParsedQuery;
}

/** 路由结果 */
export interface RoutingResult {
  /** 选中的数据源名(只搜这些) */
  selected: string[];
  /** 被跳过的数据源名(召回不足时扩展这些) */
  skipped: string[];
  /** 路由原因(供 AI 调试和理解) */
  reason: string;
  /** 触发路由的规则名(如 'hardware'/'python-ecosystem'/...) */
  ruleName: string;
}

/** 单条路由规则 */
interface RoutingRule {
  /** 规则名(用于 routingResult.ruleName) */
  name: string;
  /** 判断是否命中该规则 */
  match: (ctx: RoutingContext) => boolean;
  /** 命中时选中的数据源 */
  selectedSources: string[];
  /** 路由原因(给 AI 看)。函数形式,因为可能引用 ctx 动态字段 */
  reason: (ctx: RoutingContext) => string;
}

/**
 * 路由规则表(按优先级从高到低)。
 * 第一条命中的规则生效,后续规则不再判断。
 *
 * 设计原则:
 * - ecosystem 优先(用户/AI 显式指定最准)
 * - 强信号关键词次之(stepper/motor/ui/model 等)
 * - 兜底:无匹配 → 全搜(保持现有行为)
 */
const ROUTING_RULES: RoutingRule[] = [
  // 1. ecosystem=python → Python 生态
  {
    name: 'python-ecosystem',
    match: (ctx) => ctx.ecosystem === 'python',
    selectedSources: ['pypi', 'github', 'librariesio', 'web'],
    reason: () => 'ecosystem=python → Python 生态(PyPI/GitHub/Libraries.io),跳过 npm/VSCode/HuggingFace',
  },
  // 2. ecosystem=js/ts → JS/TS 生态
  {
    name: 'js-ts-ecosystem',
    match: (ctx) => ctx.ecosystem === 'js' || ctx.ecosystem === 'ts',
    selectedSources: ['registry', 'github', 'librariesio', 'web'],
    reason: () => 'ecosystem=js/ts → JS/TS 生态(npm/GitHub/Libraries.io),跳过 PyPI/HuggingFace',
  },
  // 3. ecosystem=rust → Rust 生态(crates.io/GitHub)
  {
    name: 'rust-ecosystem',
    match: (ctx) => ctx.ecosystem === 'rust',
    selectedSources: ['registry', 'github', 'librariesio', 'web'],
    reason: () => 'ecosystem=rust → Rust 生态(crates.io/GitHub/Libraries.io),跳过 npm/PyPI/Maven/RubyGems/GoPkg',
  },
  // 4. ecosystem=go → Go 生态(pkg.go.dev/GitHub)
  {
    name: 'go-ecosystem',
    match: (ctx) => ctx.ecosystem === 'go',
    selectedSources: ['gopkg', 'github', 'librariesio', 'web'],
    reason: () => 'ecosystem=go → Go 生态(pkg.go.dev/GitHub/Libraries.io),跳过 npm/PyPI/Maven/RubyGems',
  },
  // 5. ecosystem=java → Java/Kotlin 生态(Maven Central/GitHub)
  {
    name: 'java-ecosystem',
    match: (ctx) => ctx.ecosystem === 'java' || ctx.ecosystem === 'kotlin',
    selectedSources: ['maven', 'github', 'librariesio', 'web'],
    reason: (ctx) => `ecosystem=${ctx.ecosystem} → Java/Kotlin 生态(Maven Central/GitHub/Libraries.io),跳过 npm/PyPI/RubyGems/GoPkg`,
  },
  // 6. ecosystem=ruby → Ruby 生态(RubyGems/GitHub)
  {
    name: 'ruby-ecosystem',
    match: (ctx) => ctx.ecosystem === 'ruby',
    selectedSources: ['rubygems', 'github', 'librariesio', 'web'],
    reason: () => 'ecosystem=ruby → Ruby 生态(RubyGems/GitHub/Libraries.io),跳过 npm/PyPI/Maven/GoPkg',
  },
  // 7. ecosystem=cpp/arduino → 硬件类,只在 GitHub/Gitee/PapersWithCode 搜
  {
    name: 'cpp-arduino-ecosystem',
    match: (ctx) => ctx.ecosystem === 'cpp' || ctx.ecosystem === 'arduino',
    selectedSources: ['github', 'gitee', 'github-code', 'librariesio', 'paperswithcode', 'web'],
    reason: (ctx) => `ecosystem=${ctx.ecosystem} → C++/Arduino 生态(GitHub/Gitee/Libraries.io),跳过 npm/PyPI/Maven/RubyGems/GoPkg`,
  },
  // 5. 硬件类关键词(stepper/motor/servo/esp32/stm32 等)—— 即使没传 ecosystem 也路由
  {
    name: 'hardware-keywords',
    match: (ctx) => isHardwareQuery(ctx.translatedQuery),
    selectedSources: ['github', 'gitee', 'github-code', 'paperswithcode', 'web'],
    reason: () => 'query 含硬件关键词(stepper/motor/servo/esp32/stm32/...) → C++/Arduino 生态,跳过 npm/PyPI/Libraries.io/VSCode/HuggingFace',
  },
  // 6. VSCode 插件(vscode/extension/插件/扩展)
  // 注:中文词(插件/扩展)不用 \b,因为 \b 是英文词边界,中文上下文不生效
  {
    name: 'vscode-extension',
    match: (ctx) => /\b(vscode|vs[\s-]?code|extension)\b/i.test(ctx.query) || /(插件|扩展)/.test(ctx.query),
    selectedSources: ['vscode-marketplace', 'github', 'web'],
    reason: () => 'query 含 VSCode 插件信号 → VSCode Marketplace/GitHub,跳过 npm/PyPI/HuggingFace/PapersWithCode',
  },
  // 7. AI/ML 模型(model/training/llm/inference/neural/transformer)
  {
    name: 'ai-ml-model',
    match: (ctx) => isAiMlQuery(ctx.translatedQuery),
    selectedSources: ['huggingface', 'paperswithcode', 'github', 'web'],
    reason: () => 'query 含 AI/ML 关键词(model/training/llm/inference/...) → HuggingFace/PapersWithCode/GitHub,跳过 npm/PyPI/VSCode',
  },
  // 8. 论文/算法(paper/algorithm/论文/算法)
  // 注:中文词(论文/算法)不用 \b
  {
    name: 'paper-algorithm',
    match: (ctx) => /\b(paper|algorithm)\b/i.test(ctx.query) || /(论文|算法)/.test(ctx.query),
    selectedSources: ['paperswithcode', 'github', 'web'],
    reason: () => 'query 含论文/算法信号 → PapersWithCode/GitHub,跳过 npm/PyPI/VSCode/HuggingFace',
  },
  // 9. 代码片段(snippet/example/function/implementation/片段/示例/函数/实现)
  // 注:中文词不用 \b
  {
    name: 'code-snippet',
    match: (ctx) => /\b(snippet|example|function|implementation)\b/i.test(ctx.query) || /(片段|示例|函数|实现|源码)/.test(ctx.query),
    selectedSources: ['github-code', 'github', 'web'],
    reason: () => 'query 含代码片段信号 → GitHub Code Search/GitHub,跳过包管理器/HuggingFace',
  },
  // 10. 前端 UI(react/vue/component/form/table/chart/ui/前端/组件/表格/图表)
  {
    name: 'frontend-ui',
    match: (ctx) => isFrontendQuery(ctx.query, ctx.translatedQuery),
    selectedSources: ['registry', 'github', 'librariesio', 'web'],
    reason: () => 'query 含前端 UI 信号 → JS/TS 生态(npm/GitHub/Libraries.io),跳过 PyPI/VSCode/HuggingFace',
  },
];

/**
 * 路由入口:根据 query 上下文选择数据源子集。
 *
 * @returns RoutingResult
 *   - selected: 选中的数据源(只搜这些)
 *   - skipped: 被跳过的数据源(召回不足时扩展这些)
 *   - 无匹配时 selected = ALL_SOURCES, skipped = []
 */
export function routeSources(ctx: RoutingContext): RoutingResult {
  for (const rule of ROUTING_RULES) {
    if (rule.match(ctx)) {
      const selected = rule.selectedSources;
      const skipped = ALL_SOURCES.filter(s => !selected.includes(s));
      return { selected, skipped, reason: rule.reason(ctx), ruleName: rule.name };
    }
  }
  // 兜底:无匹配 → 全搜(保持现有行为)
  return {
    selected: [...ALL_SOURCES],
    skipped: [],
    reason: '无强信号匹配 → 全搜(保持召回完整)',
    ruleName: 'fallback-all',
  };
}

// ===== 关键词识别辅助函数 =====

/**
 * AI/ML 类 query 检测:model/training/llm/inference/neural/transformer/bert/gpt/embedding。
 * 注意:'model' 是高频词,单独匹配会过激,需要组合其他 ML 词汇。
 */
function isAiMlQuery(translated: string): boolean {
  const lower = translated.toLowerCase();
  // 强信号:这些词几乎只在 ML 语境出现
  if (/\b(llm|transformer|bert|gpt|embedding|vector|neural[\s-]?network|huggingface)\b/.test(lower)) return true;
  // 组合信号:model/training/inference 与至少 1 个其他 ML 词共现
  const hasModelWord = /\b(model|training|inference|dataset|fine[\s-]?tune)\b/.test(lower);
  const hasOtherMlWord = /\b(ai|ml|machine[\s-]?learning|deep[\s-]?learning|tensor|pytorch|tensorflow|neural)\b/.test(lower);
  return hasModelWord && hasOtherMlWord;
}

/**
 * 前端 UI 类 query 检测:react/vue/component/form/table/chart/ui 等。
 * 同时检查原始 query(中文)和翻译后 query(英文)。
 */
function isFrontendQuery(query: string, translated: string): boolean {
  const combined = `${query} ${translated}`.toLowerCase();
  // 框架名(强信号)
  if (/\b(react|vue|angular|svelte|next[\s-]?js|nuxt)\b/.test(combined)) return true;
  // UI 组件词
  if (/\b(component|form|table|chart|datagrid|button|modal|dialog|dropdown|navbar|sidebar|widget)\b/.test(combined)) return true;
  // 中文 UI 词
  if (/(前端|组件|表格|图表|按钮|弹窗|输入框|菜单|轮播|下拉)/.test(combined)) return true;
  return false;
}
