// tests/classifier/queryClassifier.test.ts
import { describe, it, expect } from 'vitest';
import { classify } from '../../src/classifier/queryClassifier.js';

describe('classify', () => {
  it('returns explicit hint when not auto', () => {
    expect(classify('whatever', 'feature')).toBe('feature');
    expect(classify('whatever', 'project')).toBe('project');
  });

  it('detects feature signals', () => {
    expect(classify('parse markdown to pdf')).toBe('feature');
    expect(classify('compress images in bulk')).toBe('feature');
  });

  it('detects project signals', () => {
    expect(classify('build a notion-like notes app')).toBe('project');
    expect(classify('markdown editor with dashboard')).toBe('project');
  });

  it('defaults to project when tied or unknown', () => {
    expect(classify('random unknown phrase')).toBe('project');
    expect(classify('app parse')).toBe('project'); // 1-1 tie
  });

  it('handles chinese signal words', () => {
    expect(classify('解析 markdown')).toBe('feature');
    expect(classify('做一个笔记应用')).toBe('project');
  });

  // ===== Phase 5 新增:嵌入式领域 feature 信号词 =====

  it('classifies stepper motor driver as feature', () => {
    // driver/motor/stepper 都是 feature 信号词,应归 feature(找驱动库,非完整项目)
    expect(classify('stepper motor driver')).toBe('feature');
  });

  it('classifies motor control as feature', () => {
    expect(classify('motor control')).toBe('feature');
  });

  it('classifies servo pwm driver as feature', () => {
    expect(classify('servo pwm driver')).toBe('feature');
  });

  it('classifies Chinese 电机驱动 as feature', () => {
    expect(classify('电机驱动')).toBe('feature');
    expect(classify('步进电机驱动')).toBe('feature');
  });

  it('classifies encoder hal driver as feature', () => {
    expect(classify('encoder hal driver')).toBe('feature');
  });
});
