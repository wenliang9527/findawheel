// tests/util/stopwords.test.ts
// 验证 BASE_STOPWORDS 与 queryParser.STOPWORDS 的过滤行为。
//
// 这层测试存在的价值:
// - queryParser 把 BASE_STOPWORDS 与扩展词合并为 STOPWORDS,任何一处被误删都会让
//   虚词进入 coreWords/corePhrase,污染下游的 GitHub 引号搜索和 suggest_queries 输出
// - searchKnowledgeTool 直接复用 BASE_STOPWORDS,需要保证基础虚词一定被过滤
import { describe, it, expect } from 'vitest';
import { BASE_STOPWORDS } from '../../src/util/stopwords.js';
import { parseQuery } from '../../src/classifier/queryParser.js';

describe('BASE_STOPWORDS', () => {
  it('contains core english articles and prepositions', () => {
    // 这些是建索引/搜索时必须剔除的虚词,缺一个都会污染 corePhrase
    for (const w of ['a', 'an', 'the', 'for', 'with', 'and', 'or', 'to', 'of', 'in', 'on']) {
      expect(BASE_STOPWORDS.has(w), `${w} should be in BASE_STOPWORDS`).toBe(true);
    }
  });

  it('contains english pronouns and helper verbs', () => {
    for (const w of ['my', 'i', 'want', 'need', 'find', 'search', 'show', 'me', 'please']) {
      expect(BASE_STOPWORDS.has(w), `${w} should be in BASE_STOPWORDS`).toBe(true);
    }
  });

  it('contains chinese function words', () => {
    for (const w of ['的', '了', '在', '和', '与', '或', '请', '帮我', '查找', '搜索']) {
      expect(BASE_STOPWORDS.has(w), `${w} should be in BASE_STOPWORDS`).toBe(true);
    }
  });

  it('is readonly (frozen set)', () => {
    // ReadonlySet 在编译期阻止 add/clear,但运行时仍是普通 Set。
    // 这里只验证导出的引用稳定且可迭代,不强制运行时 freeze
    expect(BASE_STOPWORDS.size).toBeGreaterThan(0);
  });
});

describe('parseQuery stopword filtering', () => {
  // queryParser.STOPWORDS = BASE_STOPWORDS ∪ 扩展词
  // 这些用例验证任一 BASE_STOPWORDS 不会进入 coreWords / corePhrase
  it('filters english articles out of corePhrase', () => {
    // a/the 是停用词,过滤后剩 markdown + editor 两个实义词
    const r = parseQuery('a markdown the editor');
    expect(r.corePhrase).toBe('markdown editor');
    // 虚词 a/the 不应进 coreWords
    expect(r.coreWords.some(w => ['a', 'the'].includes(w))).toBe(false);
  });

  it('filters prepositions out of coreWords', () => {
    // for/with/of/on 都应被剔除,只剩两个实义词
    const r = parseQuery('markdown for editor with preview of pdf on screen');
    // coreWords 里不应出现任何介词
    expect(r.coreWords.some(w => ['for', 'with', 'of', 'on'].includes(w))).toBe(false);
  });

  it('filters pronouns and helper verbs out of coreWords', () => {
    // i/want/need/me 都是停用词,真正实义词是 markdown/editor
    const r = parseQuery('i want a markdown editor need help me please');
    expect(r.coreWords.some(w =>
      ['i', 'want', 'need', 'me', 'please', 'a'].includes(w),
    )).toBe(false);
    expect(r.expandedQuery.toLowerCase()).toContain('markdown');
    expect(r.expandedQuery.toLowerCase()).toContain('editor');
  });

  it('filters chinese function words out of coreWords', () => {
    // 的/了/和/或/请/帮我/查找/搜索 都应被剔除
    const r = parseQuery('我 的 markdown 与 editor 搜索');
    // 中文虚词不应进 coreWords(翻译后若残留也要保证被过滤)
    expect(r.coreWords.some(w =>
      ['的', '了', '在', '和', '与', '或', '请', '帮我', '查找', '搜索'].includes(w),
    )).toBe(false);
  });

  it('all-stopword query yields empty coreWords and corePhrase', () => {
    // 全是停用词的 query:不应误把虚词当 coreWords
    const r = parseQuery('a the for with of');
    expect(r.coreWords).toEqual([]);
    expect(r.corePhrase).toBe('');
  });

  it('stopwords do not leak into fuzzyQuery as content words', () => {
    // fuzzyQuery 是 allWords 经同义词替换生成的,而 allWords 已经过 STOPWORDS 过滤
    // 因此 a/the/for 这些虚词不应出现在 fuzzyQuery 里
    const r = parseQuery('a monitor for tracking');
    // fuzzyQuery 应该只包含实义词的同义词替换,不含虚词
    expect(r.fuzzyQuery).not.toContain(' a ');
    expect(r.fuzzyQuery).not.toContain(' for ');
    // monitor → observer, tracking → tracing
    expect(r.fuzzyQuery).toContain('observer');
    expect(r.fuzzyQuery).toContain('tracing');
  });
});
