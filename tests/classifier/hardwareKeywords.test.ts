// tests/classifier/hardwareKeywords.test.ts
import { describe, it, expect } from 'vitest';
import {
  HARDWARE_WORDS_RE,
  EMBEDDED_PLATFORM_RE,
  ARDUINO_RE,
  isHardwareQuery,
} from '../../src/classifier/hardwareKeywords.js';

describe('hardwareKeywords', () => {
  describe('HARDWARE_WORDS_RE', () => {
    it('匹配通用硬件词', () => {
      expect(HARDWARE_WORDS_RE.test('stepper motor')).toBe(true);
      expect(HARDWARE_WORDS_RE.test('servo control')).toBe(true);
      expect(HARDWARE_WORDS_RE.test('pwm driver')).toBe(true);
      expect(HARDWARE_WORDS_RE.test('encoder feedback')).toBe(true);
      expect(HARDWARE_WORDS_RE.test('bldc actuator sensor')).toBe(true);
    });

    it('不匹配非硬件词', () => {
      expect(HARDWARE_WORDS_RE.test('react component')).toBe(false);
      expect(HARDWARE_WORDS_RE.test('markdown editor')).toBe(false);
    });

    it('用词边界避免误匹配', () => {
      // 'motor' 不应匹配 'motivation'
      expect(HARDWARE_WORDS_RE.test('motivation')).toBe(false);
      // 'pulse' 不应匹配 'impulse'
      expect(HARDWARE_WORDS_RE.test('impulse')).toBe(false);
    });

    // 注:正则本身大小写敏感;isHardwareQuery 内部用 toLowerCase 做大小写不敏感
  });

  describe('EMBEDDED_PLATFORM_RE', () => {
    it('匹配嵌入式平台关键词', () => {
      expect(EMBEDDED_PLATFORM_RE.test('esp32 project')).toBe(true);
      expect(EMBEDDED_PLATFORM_RE.test('stm32 hal')).toBe(true);
      expect(EMBEDDED_PLATFORM_RE.test('raspberry pi gpio')).toBe(true);
      expect(EMBEDDED_PLATFORM_RE.test('microcontroller firmware')).toBe(true);
      expect(EMBEDDED_PLATFORM_RE.test('embedded mcu')).toBe(true);
    });

    it('不匹配非嵌入式词', () => {
      expect(EMBEDDED_PLATFORM_RE.test('node.js server')).toBe(false);
      expect(EMBEDDED_PLATFORM_RE.test('docker container')).toBe(false);
    });
  });

  describe('ARDUINO_RE', () => {
    it('匹配 arduino 关键词', () => {
      expect(ARDUINO_RE.test('arduino sketch')).toBe(true);
      expect(ARDUINO_RE.test('for arduino')).toBe(true);
    });

    it('不匹配非 arduino 词', () => {
      expect(ARDUINO_RE.test('node.js')).toBe(false);
    });
  });

  describe('isHardwareQuery', () => {
    it('硬件词命中返回 true', () => {
      expect(isHardwareQuery('stepper motor library')).toBe(true);
      expect(isHardwareQuery('servo control')).toBe(true);
    });

    it('嵌入式平台命中返回 true', () => {
      expect(isHardwareQuery('esp32 wifi')).toBe(true);
      expect(isHardwareQuery('stm32 hal driver')).toBe(true);
    });

    it('arduino 命中返回 true', () => {
      expect(isHardwareQuery('arduino blink')).toBe(true);
    });

    it('纯软件 query 返回 false', () => {
      expect(isHardwareQuery('react hooks')).toBe(false);
      expect(isHardwareQuery('markdown editor')).toBe(false);
      expect(isHardwareQuery('http client')).toBe(false);
    });

    it('空字符串返回 false', () => {
      expect(isHardwareQuery('')).toBe(false);
    });

    it('大小写不敏感', () => {
      expect(isHardwareQuery('STEPPER MOTOR')).toBe(true);
      expect(isHardwareQuery('Arduino')).toBe(true);
    });
  });
});
