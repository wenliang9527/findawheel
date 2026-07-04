// tests/classifier/queryTranslator.test.ts
import { describe, it, expect } from 'vitest';
import { translateQuery, extractKeywords } from '../../src/classifier/queryTranslator.js';

describe('translateQuery', () => {
  it('returns original query when no Chinese keyword matches', () => {
    expect(translateQuery('markdown editor')).toBe('markdown editor');
  });

  it('translates Chinese keywords to English and appends them', () => {
    const result = translateQuery('图片水印');
    expect(result).toContain('图片水印');
    expect(result).toContain('image');
    expect(result).toContain('watermark');
  });

  it('translates multiple Chinese keywords in one query', () => {
    const result = translateQuery('图片压缩');
    expect(result).toContain('图片压缩');
    expect(result).toContain('image');
    expect(result).toContain('compress');
    expect(result).toContain('compression');
  });

  it('preserves English words mixed with Chinese', () => {
    const result = translateQuery('markdown 解析');
    expect(result).toContain('markdown');
    expect(result).toContain('解析');
    expect(result).toContain('parse');
    expect(result).toContain('parser');
  });
});

describe('extractKeywords', () => {
  it('extracts English keywords from query', () => {
    const kws = extractKeywords('markdown to pdf');
    expect(kws).toContain('markdown');
    expect(kws).toContain('pdf');
    // stopwords filtered
    expect(kws).not.toContain('to');
  });

  it('includes translated English for Chinese query', () => {
    const kws = extractKeywords('图片水印');
    expect(kws).toContain('image');
    expect(kws).toContain('watermark');
  });

  it('filters out stopwords', () => {
    const kws = extractKeywords('i want a markdown editor');
    expect(kws).toContain('markdown');
    expect(kws).toContain('editor');
    expect(kws).not.toContain('i');
    expect(kws).not.toContain('want');
    expect(kws).not.toContain('a');
  });
});

// ===== Phase 5 新增:嵌入式领域翻译表 =====
describe('translateQuery - embedded domain', () => {
  it('translates 步进电机 to stepper-motor/stepper', () => {
    const result = translateQuery('步进电机驱动');
    expect(result).toContain('步进电机');
    expect(result).toContain('stepper-motor');
    expect(result).toContain('stepper');
    expect(result).toContain('driver');
  });

  it('translates 单片机 to microcontroller/mcu/embedded', () => {
    const result = translateQuery('单片机');
    expect(result).toContain('microcontroller');
    expect(result).toContain('mcu');
    expect(result).toContain('embedded');
  });

  it('translates 电机/马达 to motor', () => {
    expect(translateQuery('电机')).toContain('motor');
    expect(translateQuery('马达')).toContain('motor');
  });

  it('translates 伺服/舵机 to servo', () => {
    expect(translateQuery('伺服')).toContain('servo');
    expect(translateQuery('舵机')).toContain('servo');
  });

  it('translates 微控制器 to microcontroller/mcu', () => {
    const result = translateQuery('微控制器');
    expect(result).toContain('microcontroller');
    expect(result).toContain('mcu');
  });

  it('translates 嵌入式 to embedded', () => {
    expect(translateQuery('嵌入式')).toContain('embedded');
  });

  it('translates 脉冲 to pulse/pwm', () => {
    const result = translateQuery('脉冲');
    expect(result).toContain('pulse');
    expect(result).toContain('pwm');
  });

  it('translates 加减速 to acceleration/accelstepper', () => {
    const result = translateQuery('加减速');
    expect(result).toContain('acceleration');
    expect(result).toContain('accelstepper');
  });

  it('translates 编码器 to encoder', () => {
    expect(translateQuery('编码器')).toContain('encoder');
  });

  it('translates 树莓派 to raspberry-pi/rpi', () => {
    const result = translateQuery('树莓派');
    expect(result).toContain('raspberry-pi');
    expect(result).toContain('rpi');
  });

  it('translates mixed Chinese embedded query to multiple English terms', () => {
    // 用户搜"步进电机驱动程序 单片机",应该翻译出多个英文词
    const result = translateQuery('步进电机驱动程序 单片机');
    expect(result).toContain('stepper');
    expect(result).toContain('motor');
    expect(result).toContain('driver');
    expect(result).toContain('microcontroller');
    expect(result).toContain('mcu');
  });
});
