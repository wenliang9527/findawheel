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
