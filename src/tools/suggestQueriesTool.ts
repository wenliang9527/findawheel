// src/tools/suggestQueriesTool.ts
// suggest_queries 工具:接收用户原始 query,返回多个搜索词变体。
// 目的:让 AI 在调 find_wheel 前,先看到结构化的搜索词建议,选择最合适的。
//
// findawheel 是 MCP Server,不能调 LLM,所以这里用 queryParser 的规则版
// 生成多角度搜索词(精准/动作导向/模糊/简洁)。

import { parseQuery } from '../classifier/queryParser.js';
import { translateQuery } from '../classifier/queryTranslator.js';
import { classify } from '../classifier/queryClassifier.js';
import { HARDWARE_WORDS_RE, EMBEDDED_PLATFORM_RE, ARDUINO_RE } from '../classifier/hardwareKeywords.js';
import type { Intent } from '../normalize/types.js';
import type { McpToolResult } from './types.js';

export interface SuggestQueriesInput {
  /** 用户原始 query(中英文皆可) */
  query: string;
  ecosystem?: string;
}

export interface QuerySuggestion {
  /** 搜索词角度标签 */
  angle: 'precise' | 'action_oriented' | 'fuzzy' | 'concise';
  /** 角度的中文说明 */
  description: string;
  /** 建议的英文搜索词 */
  query: string;
  /** 推荐使用场景 */
  when_to_use: string;
}

export interface SuggestQueriesOutput {
  /** 用户原始 query */
  originalQuery: string;
  /** 翻译后的英文 query(供参考) */
  translatedQuery: string;
  /** 推断的意图 */
  intent: Intent;
  /** 多角度搜索词建议 */
  suggestions: QuerySuggestion[];
  /** 推荐的首选搜索词 */
  recommended: string;
  /** 推荐理由 */
  reason: string;
  /**
   * 推荐的 ecosystem(可选)。
   * 当检测到硬件类 query(stepper/motor/servo/encoder/esp32/stm32 等)时,
   * 自动推荐 'arduino' 或 'cpp',因为这类库主要分布在 Arduino/C++ 生态,
   * 而非 python/js。AI 调 find_wheel 时应把这个值传给 ecosystem 参数。
   * 用户已显式传 ecosystem 时不覆盖(用用户的)。
   */
  recommendedEcosystem?: string;
}

// 硬件类关键词正则(P1-7:从 hardwareKeywords.ts 共享导入,避免与 sourceRouter 重复维护)
// 直接使用 import 的 ARDUINO_RE / EMBEDDED_PLATFORM_RE / HARDWARE_WORDS_RE

/**
 * 从翻译后的 query 检测硬件类 ecosystem 推荐。
 *
 * 优先级:
 * 1. 含 'arduino' → 'arduino'(Arduino 生态最丰富)
 * 2. 含 'esp32'/'stm32'/'raspberry'/'embedded'/'mcu'/'hal'/'gpio' → 'cpp'
 * 3. 含通用硬件词(stepper/motor/servo/encoder/pwm/pulse/driver/...)→ 'arduino'(默认最常见)
 *
 * 注意:输入用翻译后的英文 query,这样中文"步进电机"也能被识别。
 */
function detectHardwareEcosystem(translatedQuery: string): string | undefined {
  const lower = translatedQuery.toLowerCase();
  // 1. 显式 Arduino → arduino
  if (ARDUINO_RE.test(lower)) return 'arduino';
  // 2. 嵌入式平台关键词 → cpp(ESP32/STM32/树莓派等以 C++ 开发为主)
  if (EMBEDDED_PLATFORM_RE.test(lower)) return 'cpp';
  // 3. 通用硬件词 → 默认 arduino(AccelStepper 等主流库在 Arduino 生态)
  if (HARDWARE_WORDS_RE.test(lower)) return 'arduino';
  return undefined;
}

/**
 * 优化22:去重 recommended 中的重复词(如 "upload upload" → "upload")。
 * 场景:词级翻译后生成变体时,相同词可能重复出现,导致 recommended 是 "upload upload"。
 * 按大小写不敏感去重,保留首次出现的大小写形态。
 */
function dedupRecommended(s: string): string {
  const words = s.split(/\s+/);
  const seen = new Set<string>();
  return words.filter(w => {
    const lw = w.toLowerCase();
    if (seen.has(lw)) return false;
    seen.add(lw);
    return true;
  }).join(' ');
}

export function createSuggestQueriesTool() {
  async function handle(input: SuggestQueriesInput): Promise<McpToolResult> {
    if (!input.query || input.query.trim() === '') {
      return {
        content: [{ type: 'text', text: 'query is required' }],
        isError: true,
      };
    }

    const translated = translateQuery(input.query);
    const intent = classify(input.query, 'auto');
    // parseQuery 解析翻译后的英文(空格分词),而非原始中文(无空格,token 不准)
    const parsed = parseQuery(translated);

    // 生成 4 个角度的搜索词
    const suggestions: QuerySuggestion[] = [
      {
        angle: 'precise',
        description: '精准搜索(核心短语 + 修饰词)',
        query: [parsed.corePhrase, ...parsed.modifiers].join(' ').trim() || translated,
        when_to_use: '当需要精确匹配时使用,适合 GitHub 引号搜索',
      },
      {
        angle: 'action_oriented',
        description: '动作导向(动词 + 格式词)',
        query: [...parsed.coreWords, ...parsed.formatWords].join(' ').trim() || translated,
        when_to_use: '当用户意图明确是"做某事"时使用,动词优先',
      },
      {
        angle: 'fuzzy',
        description: '模糊搜索(同义词泛化)',
        query: parsed.fuzzyQuery,
        when_to_use: '当精准搜索召回不足时使用,扩大召回范围',
      },
      {
        angle: 'concise',
        description: '简洁搜索(仅核心词)',
        query: parsed.coreWords.join(' ') || parsed.corePhrase,
        when_to_use: '当 query 过长可能影响搜索时使用',
      },
    ];

    // 推荐:动作导向通常最精准(动词表达意图)
    // P2-4:用 angle 字段查找替代硬编码索引 [1],避免 suggestions 顺序调整后取错
    // 优化22:去重重复词(如 "upload upload" → "upload")
    let recommended = dedupRecommended(
      suggestions.find(s => s.angle === 'action_oriented')?.query
      ?? suggestions[0]?.query
      ?? '',
    );
    let reason = `动作导向搜索词"${recommended}"优先使用了动词(${parsed.coreWords.join('/')}),最能表达用户意图,推荐作为 find_wheel 的 query 参数`;

    // 硬件类 ecosystem 推荐:检测到硬件关键词时建议用 arduino/cpp 搜索
    // 优先级:用户显式传 > parseQuery 识别 > 硬件关键词检测
    // 用户已传 input.ecosystem 时不覆盖(用用户的)
    const detectedEcosystem = input.ecosystem ?? parsed.ecosystem;
    // 优化32:同时检测原始 query 和 translated query
    // - 原始 query:用于识别平台关键词(stm32/esp32/arduino),这些词在翻译时不会被改变
    //   但意图前缀剥离会丢失它们(如 "我要在我的stm32程序中增加" → "stm32" 被剥掉)
    //   所以这里用原始 query 兜底检测
    // - translated query:用于识别翻译后的通用硬件词(stepper/motor/servo/driver)
    //   纯中文输入如 "步进电机驱动器" 只在翻译后才出现 stepper/motor/driver
    // 优先用原始 query 检测(平台关键词优先),失败则用 translated 检测(通用硬件词)
    const recommendedEcosystem = detectedEcosystem
      ?? detectHardwareEcosystem(input.query)
      ?? detectHardwareEcosystem(translated);
    if (recommendedEcosystem && !input.ecosystem) {
      reason += `。检测到硬件类关键词,建议同时传 ecosystem="${recommendedEcosystem}" 给 find_wheel(stepper/motor/servo 等库主要在 C++/Arduino 生态,python/js 搜会漏主流库)`;
    }

    const output: SuggestQueriesOutput = {
      originalQuery: input.query,
      translatedQuery: translated,
      intent,
      suggestions,
      recommended,
      reason,
      ...(recommendedEcosystem ? { recommendedEcosystem } : {}),
    };

    return { content: [{ type: 'text', text: JSON.stringify(output) }] };
  }

  return { handle };
}
