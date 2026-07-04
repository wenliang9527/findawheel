// src/tools/suggestQueriesTool.ts
// suggest_queries 工具:接收用户原始 query,返回多个搜索词变体。
// 目的:让 AI 在调 find_wheel 前,先看到结构化的搜索词建议,选择最合适的。
//
// findawheel 是 MCP Server,不能调 LLM,所以这里用 queryParser 的规则版
// 生成多角度搜索词(精准/动作导向/模糊/简洁)。

import { parseQuery } from '../classifier/queryParser.js';
import { translateQuery } from '../classifier/queryTranslator.js';
import { classify } from '../classifier/queryClassifier.js';
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

/**
 * 硬件类关键词集合 —— 出现这些词时,推荐用 arduino/cpp ecosystem 搜索。
 * stepper/motor/servo 等主流库(AccelStepper、Marlin、GRBL)主要在 Arduino 生态,
 * 用 python/js 搜会漏掉主流库。
 */
const HARDWARE_KEYWORDS = new Set([
  // 电机/驱动类
  'stepper', 'motor', 'servo', 'encoder', 'pwm', 'pulse',
  'driver', 'actuator', 'sensor', 'bldc',
  // 嵌入式平台类
  'microcontroller', 'mcu', 'embedded', 'hal', 'gpio',
  'arduino', 'esp32', 'stm32', 'raspberry', 'rpi',
]);

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
  // 用 \b 词边界,避免 'motor' 误匹配 'motivation'
  // 1. 显式 Arduino → arduino
  if (/\barduino\b/.test(lower)) return 'arduino';
  // 2. 嵌入式平台关键词 → cpp(ESP32/STM32/树莓派等以 C++ 开发为主)
  if (/\b(esp32|stm32|raspberry|rpi|microcontroller|mcu|embedded|hal|gpio)\b/.test(lower)) return 'cpp';
  // 3. 通用硬件词 → 默认 arduino(AccelStepper 等主流库在 Arduino 生态)
  for (const word of ['stepper', 'motor', 'servo', 'encoder', 'pwm', 'pulse', 'driver', 'actuator', 'sensor', 'bldc']) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return 'arduino';
  }
  return undefined;
}

export function createSuggestQueriesTool() {
  async function handle(input: SuggestQueriesInput): Promise<McpToolResult> {
    if (!input.query || input.query.trim() === '') {
      return {
        content: [{ type: 'text', text: 'query is required' }],
        isError: true,
      };
    }

    const parsed = parseQuery(input.query);
    const intent = classify(input.query, 'auto');
    const translated = translateQuery(input.query);

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
    const recommended = suggestions[1].query;
    let reason = `动作导向搜索词"${recommended}"优先使用了动词(${parsed.coreWords.join('/')}),最能表达用户意图,推荐作为 find_wheel 的 query 参数`;

    // 硬件类 ecosystem 推荐:检测到硬件关键词时建议用 arduino/cpp 搜索
    // 优先级:用户显式传 > parseQuery 识别 > 硬件关键词检测
    // 用户已传 input.ecosystem 时不覆盖(用用户的)
    const detectedEcosystem = input.ecosystem ?? parsed.ecosystem;
    const recommendedEcosystem = detectedEcosystem ?? detectHardwareEcosystem(translated);
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
