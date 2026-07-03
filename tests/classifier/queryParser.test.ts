// tests/classifier/queryParser.test.ts
import { describe, it, expect } from 'vitest';
import { parseQuery } from '../../src/classifier/queryParser.js';

describe('parseQuery', () => {
  it('extracts core phrase from first 2 content words', () => {
    const r = parseQuery('invisible image watermark encryption');
    // stopword 'image' filtered, core = 'invisible watermark'
    expect(r.corePhrase).toBe('invisible watermark');
    expect(r.modifiers).toContain('encryption');
    // coreWords 与 corePhrase 拆词一致
    expect(r.coreWords).toEqual(['invisible', 'watermark']);
  });

  it('extracts format words from query', () => {
    const r = parseQuery('pdf to markdown converter word ppt excel');
    expect(r.formatWords).toContain('pdf');
    expect(r.formatWords).toContain('markdown');
    expect(r.formatWords).toContain('word');
    expect(r.formatWords).toContain('ppt');
    expect(r.formatWords).toContain('excel');
  });

  it('formatWords is empty when query has no format word', () => {
    const r = parseQuery('invisible image watermark');
    expect(r.formatWords).toEqual([]);
  });

  it('coreWords is empty array when query has no content words', () => {
    // 全是停用词的 query,coreWords 为空(不应触发核心词过滤)
    const r = parseQuery('a tool for library');
    expect(r.coreWords).toEqual([]);
    expect(r.corePhrase).toBe('');
  });

  it('coreWords has single element when only one content word', () => {
    const r = parseQuery('markdown');
    expect(r.coreWords).toEqual(['markdown']);
    expect(r.corePhrase).toBe('markdown');
  });

  it('translates Chinese keywords in expandedQuery', () => {
    const r = parseQuery('图片水印');
    expect(r.expandedQuery).toContain('image');
    expect(r.expandedQuery).toContain('watermark');
  });

  it('detects antonyms when query contains watermark (add intent)', () => {
    const r = parseQuery('invisible image watermark');
    expect(r.antonymExcludes).toContain('remove');
    expect(r.antonymExcludes).toContain('clean');
    expect(r.antonymExcludes).toContain('strip');
  });

  it('does NOT trigger antonym excludes when query is reverse intent', () => {
    // 用户明确想"移除水印",不应排除 remove
    const r = parseQuery('remove watermark from image');
    expect(r.antonymExcludes).not.toContain('remove');
  });

  it('detects antonyms for encrypt', () => {
    const r = parseQuery('encrypt data with aes');
    expect(r.antonymExcludes).toContain('decrypt');
    expect(r.antonymExcludes).toContain('crack');
  });

  it('returns empty antonymExcludes for neutral query', () => {
    const r = parseQuery('markdown editor');
    expect(r.antonymExcludes).toEqual([]);
  });

  it('filters out stopwords from core phrase', () => {
    const r = parseQuery('a tool for markdown');
    // 'a' 'for' 'tool' are stopwords, core = 'markdown' (only 1 content word left)
    expect(r.corePhrase).toBe('markdown');
  });
});
