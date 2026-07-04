// src/classifier/queryParser.ts
// 把自然语言 query 拆分成:核心短语 + 核心词 + 修饰词 + 格式词 + 模糊化 query。
//
// 用途:
// - corePhrase: 给 GitHub 搜索用(引号短语强制命中)
// - coreWords:  给 suggest_queries 用(动作导向搜索词)
// - modifiers:  给 suggest_queries 用(精准搜索词拼接)
// - formatWords:给 suggest_queries 用(格式词拼接)
// - fuzzyQuery: 给 findWheelTool 副搜索用(同义词泛化扩大召回)
// - expandedQuery: 给不支持复杂语法的源用(中英合并的完整 query)
//
// Phase 6 简化后:
// 删除 antonymExcludes / domain 字段。
// - antonymExcludes 是给 isReverseIntent 用的,该过滤已删(AI 自己识别反向意图)
// - domain 是给领域特化逻辑用的,所有领域特化已删(统一逻辑,避免过拟合)

import { translateQuery } from './queryTranslator.js';
import { BASE_STOPWORDS } from '../util/stopwords.js';

export interface ParsedQuery {
  /** 核心短语(前 2 个实义词),用于引号包裹强制命中(GitHub 搜索) */
  corePhrase: string;
  /**
   * 核心词(动词优先),用于 suggest_queries 生成动作导向搜索词。
   * 优先从 query 里挑动作动词(monitor/convert/parse...),
   * 因为动词表达用户真正的意图,比对象词(coding/assistant)更能区分相关结果。
   */
  coreWords: string[];
  /** 修饰词(剩余的实义词),作为可选命中加分 */
  modifiers: string[];
  /** 展开后的完整 query(含中文翻译),用于传给不支持复杂语法的源 */
  expandedQuery: string;
  /** query 里出现的格式词(pdf/word/ppt/excel 等),用于 suggest_queries */
  formatWords: string[];
  /** 模糊化语义 query(同义词/上位词泛化),用于副搜索扩大召回 */
  fuzzyQuery: string;
  /**
   * Q1:从 query 自动识别的 ecosystem(如 'python'/'js'/'rust'/'go'/'java')。
   * 识别模式:"python 库"/"js 包"/"rust crate"/"npm 包"/"go module" 等。
   * 缺失时为 undefined(用户未指定 ecosystem)。
   */
  ecosystem?: string;
}

/**
 * 查询解析用的停用词集合 = 基础停用词 + 意图动词 + 通用技术词。
 *
 * 基础停用词复用 util/stopwords.ts 的 BASE_STOPWORDS(避免与 searchKnowledgeTool 重复)。
 * 此处扩展的部分是 queryParser 专用的:
 * - 通用技术词(image/tool/library 等)不当核心
 * - 意图动词(want/make/build/create 等)表达用户想做什么,不是搜索对象本身
 * - 中文意图词(想做/想要/帮我 等,翻译后可能仍是中文)
 *
 * 注意:implement/function/snippet/example/sample 已在 ACTION_VERBS,这里不再列入
 * STOPWORDS,否则会在过滤阶段被剔除,无法成为 coreWords(参见 queryParser 测试)
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  ...BASE_STOPWORDS,
  'looking', 'image', 'tool', 'library', 'lib', 'package', 'pkg', 'project',
  'wants', 'wanna', 'make', 'build', 'create', 'write', 'develop',
  'could', 'would', 'should', 'can', 'may',
  'good', 'best', 'popular', 'recommend', 'recommended',
  'some', 'any', 'all', 'every', 'this', 'that', 'these', 'those',
  '想做', '想要', '帮助', '实现', '开发', '编写', '创建', '构建',
  '一个', '这个', '那种', '这种',
]);

/**
 * Q3:复合词拆分 —— 把 "image-watermark"/"serial_port" 等连字符/下划线连接的词拆成多个词。
 * 场景:用户输入 "image-watermark-removal" 时,拆为 image/watermark/removal 三个词,
 * 让每个词都能独立匹配 description 和 topics。
 */
function splitCompoundWords(query: string): string {
  // 把连字符/下划线/斜杠连接的词用空格分隔
  // 但保留 GitHub owner/repo 格式(如 a/b),这种格式在 GitHub 搜索里有特殊含义
  // 简单策略:只在非 owner/repo 上下文拆分
  return query
    .replace(/([a-z])-([a-z])/gi, '$1 $2')  // image-watermark → image watermark
    .replace(/([a-z])_([a-z])/gi, '$1 $2')   // serial_port → serial port
    .replace(/([a-z])\/([a-z])/gi, '$1 $2')  // image/watermark → image watermark(但 owner/repo 也会被拆,可接受)
    .trim();
}

/**
 * 文件格式词:query 里出现这些词时,suggest_queries 会把它们拼进动作导向搜索词。
 * 也用于 AI 判断用户想要的输入输出格式。
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
 * - 硬件类:drive/control/step/pwm...(嵌入式场景)
 * - 串口类:scan/sniff/terminal/console...(串口调试场景)
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
  // 硬件/嵌入式类(补嵌入式领域盲区)
  'drive', 'driver', 'control', 'controller', 'spin', 'rotate', 'rotation',
  'step', 'stepper', 'pulse', 'pwm', 'accelerate', 'acceleration', 'decelerate',
  'position', 'move', 'moving',
  // 串口/调试类(补串口调试助手场景)
  'scan', 'sniff', 'terminal', 'console', 'bridge', 'tunnel',
]);

/**
 * 同义词/上位词表,用于生成 fuzzyQuery(模糊化语义副搜索)。
 * 把 query 里的词替换成更宽泛的同义词,扩大召回。
 * 例:monitor → observer/watcher, coding → development/dev
 *
 * 注意:每个词的第一项不能是原词,否则 fuzzyQuery 取 syns[0] 等于原词,无泛化效果。
 */
const SYNONYMS: Record<string, string[]> = {
  monitor: ['observer', 'watcher', 'tracker', 'dashboard', 'monitor'],
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
  // 硬件/嵌入式类(补嵌入式领域盲区) - 注意第一项不能是原词
  motor: ['actuator', 'drive', 'motor'],
  driver: ['controller', 'driver'],
  microcontroller: ['mcu', 'arduino', 'esp32', 'stm32', 'microcontroller'],
  stepper: ['stepper-motor', 'stepper'],
  servo: ['servo-motor', 'servo'],
  encoder: ['sensor', 'encoder'],
  pulse: ['pwm', 'pulse'],
  // 串口/调试类(补串口调试助手场景) - 注意第一项不能是原词
  serial: ['uart', 'serial', 'rs232'],
  uart: ['usart', 'uart', 'serial'],
  debug: ['diagnostic', 'debug', 'troubleshoot'],
  terminal: ['console', 'terminal', 'shell'],
  // B. 召回扩展:多领域同义词补充(2026-07-04)
  // 前端类
  ui: ['interface', 'gui', 'ui'],
  form: ['input-form', 'form'],
  table: ['grid', 'datagrid', 'table'],
  chart: ['charting', 'plot', 'graph'],
  animation: ['motion', 'animation'],
  drag: ['dnd', 'draggable', 'drag'],
  // AI/LLM 类
  llm: ['large-language-model', 'llm'],
  prompt: ['prompt-template', 'prompt'],
  embedding: ['vector-embedding', 'embedding'],
  agent: ['autonomous-agent', 'agent'],
  chat: ['dialog', 'conversation', 'chat'],
  translation: ['translate', 'translation'],
  // DevOps 类
  deploy: ['deployment', 'release', 'deploy'],
  pipeline: ['workflow', 'ci-cd', 'pipeline'],
  proxy: ['reverse-proxy', 'gateway', 'proxy'],
  // 数据科学类
  train: ['training', 'fit', 'train'],
  inference: ['prediction', 'inference'],
  model: ['neural-network', 'model'],
  // 安全类
  encrypt: ['cipher', 'crypto', 'encrypt'],
  hash: ['digest', 'checksum', 'hash'],
  // 存储/数据库类
  database: ['db', 'storage', 'database'],
  cache: ['redis', 'memcache', 'cache'],
  queue: ['message-queue', 'mq', 'queue'],
  // 通用类
  scaffold: ['boilerplate', 'starter', 'template'],
  search: ['query', 'lookup', 'search'],
  recommend: ['suggestion', 'recommendation'],
  convert: ['transform', 'export', 'convert'],
  parse: ['extract', 'analyze', 'parse'],
  // Q6:继续扩展 —— 高频技术词的同义词泛化(只列 B 段未覆盖的新词,
  // 重复键已在 B 段定义:cache/queue/deploy/pipeline/proxy/train/inference/
  // model/encrypt/hash/ui/form/table/chart/animation/drag/llm/prompt/embedding/agent/chat/translation)
  // 状态/数据类
  state: ['store', 'state-management'],
  store: ['state', 'repository'],
  // 测试/质量类
  test: ['testing', 'spec', 'unit-test'],
  mock: ['fake', 'stub', 'mock'],
  coverage: ['coverage-report', 'codecov'],
  // 部署/运维类
  container: ['docker', 'podman', 'container'],
  // 协议/通信类
  websocket: ['ws', 'socket', 'websocket'],
  http: ['rest', 'http-client', 'http'],
  grpc: ['rpc', 'protobuf', 'grpc'],
  // 数据科学类
  dataset: ['corpus', 'data', 'dataset'],
  // 安全类
  auth: ['authentication', 'authn', 'auth'],
};

/**
 * Q1:从 query 识别 ecosystem。
 * 识别模式:
 * - 中文:"python 库"/"js 包"/"rust 框架" 等
 * - 英文:"python library"/"js package"/"rust crate" 等
 * - 包管理器名:"npm 包"/"pypi 包"/"cargo crate" 等
 * 返回标准化的 ecosystem 名('python'/'js'/'ts'/'rust'/'go'/'java'/'csharp'/'cpp'/'php'/'ruby'/'swift'/'kotlin'),
 * 未识别返回 undefined。
 *
 * 优化:语言+资源词模式共用 LANG_RES 后缀常量(避免 11 处重复同一组中文/英文同义词),
 * 包管理器(pypi/npm/cargo/maven/composer)走各自更短的短词集合。
 */
const LANG_RES = '[\\s_-]*(库|包|框架|模块|module|library|package|framework)';

const ECOSYSTEM_PATTERNS: Array<{ pattern: RegExp; ecosystem: string }> = [
  // 语言名 + 通用资源词后缀(库/包/框架/模块 + 英文同义词)
  { pattern: new RegExp(`\\b(python|py)\\b${LANG_RES}`, 'i'), ecosystem: 'python' },
  { pattern: new RegExp(`\\b(js|javascript)\\b${LANG_RES}`, 'i'), ecosystem: 'js' },
  { pattern: new RegExp(`\\b(ts|typescript)\\b${LANG_RES}`, 'i'), ecosystem: 'ts' },
  // node 之前漏了 模块/package/framework,现统一用 LANG_RES(和其他语言一致)
  { pattern: new RegExp(`\\bnode(\\.js|js)?\\b${LANG_RES}`, 'i'), ecosystem: 'js' },
  { pattern: new RegExp(`\\brust\\b[\\s_-]*(库|包|框架|模块|module|library|package|framework|crate)`, 'i'), ecosystem: 'rust' },
  { pattern: new RegExp(`\\bgo(lang)?\\b${LANG_RES}`, 'i'), ecosystem: 'go' },
  { pattern: new RegExp(`\\bjava\\b${LANG_RES}`, 'i'), ecosystem: 'java' },
  { pattern: new RegExp(`\\b(c#|csharp|dotnet|\\.net)\\b${LANG_RES}`, 'i'), ecosystem: 'csharp' },
  { pattern: new RegExp(`\\bc\\+\\+\\b${LANG_RES}`, 'i'), ecosystem: 'cpp' },
  { pattern: new RegExp(`\\bphp\\b${LANG_RES}`, 'i'), ecosystem: 'php' },
  { pattern: new RegExp(`\\bruby\\b[\\s_-]*(库|包|框架|模块|module|library|package|framework|gem)`, 'i'), ecosystem: 'ruby' },
  { pattern: new RegExp(`\\bswift\\b${LANG_RES}`, 'i'), ecosystem: 'swift' },
  { pattern: new RegExp(`\\bkotlin\\b${LANG_RES}`, 'i'), ecosystem: 'kotlin' },
  // 包管理器名 + 各自的短词集合(crate/package/artifact/gem 等)
  { pattern: /\bpypi\b[\s_-]*(包|package)/i, ecosystem: 'python' },
  { pattern: /\bnpm\b[\s_-]*(包|package)/i, ecosystem: 'js' },
  { pattern: /\bcargo\b[\s_-]*(crate|package)/i, ecosystem: 'rust' },
  { pattern: /\bmaven\b[\s_-]*(package|artifact)/i, ecosystem: 'java' },
  { pattern: /\bcomposer\b[\s_-]*(package)/i, ecosystem: 'php' },
];

function detectEcosystem(query: string): string | undefined {
  for (const { pattern, ecosystem } of ECOSYSTEM_PATTERNS) {
    if (pattern.test(query)) return ecosystem;
  }
  return undefined;
}

/**
 * 解析 query,拆分核心词/修饰词。
 *
 * @example
 * parseQuery('AI coding assistant monitor status tracking')
 * // {
 * //   corePhrase: 'ai coding',           // 前 2 个实义词(给 GitHub 引号搜索)
 * //   coreWords: ['monitor', 'tracking'], // 动词优先(给 suggest_queries 动作导向)
 * //   modifiers: ['assistant', 'status'],
 * //   formatWords: [],
 * //   fuzzyQuery: 'AI development agent observer health tracing',
 * //   ...
 * // }
 */
export function parseQuery(query: string): ParsedQuery {
  // Q3:先拆分复合词(image-watermark → image watermark)
  const splitQuery = splitCompoundWords(query);

  // 1. 先翻译中文,中英合并
  const expandedQuery = translateQuery(splitQuery);

  // Q1:识别 ecosystem(用原始 query,因为翻译可能丢失上下文)
  const ecosystem = detectEcosystem(query);

  // 2. 拆词,过滤停用词和短词
  const allWords = expandedQuery
    .toLowerCase()
    .split(/[\s,，。、;；!！?？]+/)
    .filter(w => w.length > 1 && !STOPWORDS.has(w));

  // 3. corePhrase = 前 2 个实义词(给 GitHub 引号搜索用,保持原逻辑)
  const phraseWords = allWords.slice(0, 2);
  const corePhrase = phraseWords.join(' ');

  // 3.5 coreWords = 动词优先(给 suggest_queries 动作导向搜索用)
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

  // 5. 生成 fuzzyQuery:用同义词/上位词泛化,用于副搜索扩大召回
  const fuzzyWords = allWords.map(w => {
    const syns = SYNONYMS[w];
    // 70% 概率用同义词,30% 保留原词(避免完全偏离原意)
    return syns && syns.length > 0 ? syns[0] : w;
  });
  const fuzzyQuery = fuzzyWords.join(' ');

  return {
    corePhrase, coreWords, modifiers: modifierWords,
    expandedQuery, formatWords, fuzzyQuery,
    ecosystem,
  };
}
