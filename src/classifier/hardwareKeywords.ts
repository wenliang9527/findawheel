// src/classifier/hardwareKeywords.ts
// 硬件类关键词正则集中定义(P1-7)。
//
// 之前 sourceRouter.ts 的 isHardwareQuery 和 suggestQueriesTool.ts 各自定义正则,
// 新增硬件词(如 imu/can-bus)时必须同步改两处,容易遗漏。
//
// 用 \b 词边界,避免 'motor' 误匹配 'motivation'。

/** 通用硬件词(stepper/motor/servo/...) */
export const HARDWARE_WORDS_RE = /\b(stepper|motor|servo|encoder|pwm|pulse|driver|actuator|sensor|bldc)\b/;

/** 嵌入式平台关键词(esp32/stm32/raspberry/...) */
export const EMBEDDED_PLATFORM_RE = /\b(esp32|stm32|raspberry|rpi|microcontroller|mcu|embedded|hal|gpio)\b/;

/** Arduino 关键词 */
export const ARDUINO_RE = /\barduino\b/;

/**
 * 综合硬件检测:匹配通用硬件词、嵌入式平台或 Arduino 任一即返回 true。
 * sourceRouter.isHardwareQuery 的统一实现。
 */
export function isHardwareQuery(translated: string): boolean {
  const lower = translated.toLowerCase();
  return (
    HARDWARE_WORDS_RE.test(lower) ||
    EMBEDDED_PLATFORM_RE.test(lower) ||
    ARDUINO_RE.test(lower)
  );
}
