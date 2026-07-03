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
});
