// tests/classifier/queryParser.test.ts
import { describe, it, expect } from 'vitest';
import { parseQuery } from '../../src/classifier/queryParser.js';

describe('parseQuery', () => {
  it('extracts core phrase from first 2 content words', () => {
    const r = parseQuery('invisible image watermark encryption');
    // corePhrase 用前 2 个实义词(image 是停用词被过滤)
    expect(r.corePhrase).toBe('invisible watermark');
    expect(r.modifiers).toContain('encryption');
    // coreWords 动词优先:watermark 是动作动词,排在前面
    expect(r.coreWords).toEqual(['watermark', 'invisible']);
  });

  it('coreWords prioritizes action verbs (monitor over coding)', () => {
    // 用户搜 "AI coding assistant monitor status tracking"
    // 动词 monitor/status/tracking 应被选为 coreWords,而非 coding/assistant
    const r = parseQuery('AI coding assistant monitor status tracking');
    expect(r.coreWords).toContain('monitor');
    // coding/assistant 不应在 coreWords 里(它们不是动词)
    expect(r.coreWords).not.toContain('coding');
    expect(r.coreWords).not.toContain('assistant');
    // coreWords 应该都是动词
    expect(r.coreWords.every(w => ['monitor', 'status', 'tracking'].includes(w))).toBe(true);
  });

  it('generates fuzzyQuery with synonyms', () => {
    const r = parseQuery('AI coding assistant monitor');
    // fuzzyQuery 应该用同义词替换:monitor→observer, coding→development, assistant→agent
    expect(r.fuzzyQuery).toContain('observer');
    expect(r.fuzzyQuery).toContain('development');
    expect(r.fuzzyQuery).toContain('agent');
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

  // Phase 6 简化:删除 antonymExcludes 相关测试(反义词过滤已删)
  // Phase 6 简化:删除 domain 相关测试(领域特化逻辑已删)

  it('filters out stopwords from core phrase', () => {
    const r = parseQuery('a tool for markdown');
    // 'a' 'for' 'tool' are stopwords, core = 'markdown' (only 1 content word left)
    expect(r.corePhrase).toBe('markdown');
  });

  // ===== Phase 4.1 新增:代码片段关键字 =====

  it('translates Chinese 代码片段 keywords to English', () => {
    expect(parseQuery('实现 函数').expandedQuery).toContain('implementation');
    expect(parseQuery('实现 函数').expandedQuery).toContain('function');
    expect(parseQuery('代码示例').expandedQuery).toContain('snippet');
    expect(parseQuery('代码示例').expandedQuery).toContain('example');
    expect(parseQuery('源码').expandedQuery).toContain('source');
  });

  it('treats implement/function/snippet as action verbs for coreWords', () => {
    // 用户搜 "implement quicksort function"
    // implement 和 function 都是动作动词,应优先成为 coreWords
    const r = parseQuery('implement quicksort function');
    expect(r.coreWords).toContain('implement');
    expect(r.coreWords).toContain('function');
  });

  it('uses synonyms for fuzzyQuery on snippet-related words', () => {
    const r = parseQuery('parse snippet example');
    // snippet→fragment, example→sample 应出现在 fuzzyQuery
    expect(r.fuzzyQuery).toContain('fragment');
    expect(r.fuzzyQuery).toContain('sample');
  });

  // ===== Phase 5/7 保留:翻译/同义词/动词表(纯增益,无副作用) =====

  it('translates 串口 to serial/uart in expandedQuery', () => {
    const r = parseQuery('串口调试助手');
    // 翻译后应该包含 serial 或 uart
    expect(r.expandedQuery.toLowerCase()).toMatch(/serial|uart/);
  });

  it('fuzzyQuery replaces serial with uart for broader recall', () => {
    const r = parseQuery('serial debug tool');
    // fuzzyQuery 应该用同义词泛化:serial → uart
    expect(r.fuzzyQuery).toContain('uart');
  });

  it('uses synonyms for fuzzyQuery on motor/driver/microcontroller', () => {
    const r = parseQuery('motor driver microcontroller');
    // motor→actuator, driver→controller, microcontroller→mcu 应出现在 fuzzyQuery
    expect(r.fuzzyQuery).toContain('actuator');
    expect(r.fuzzyQuery).toContain('controller');
    expect(r.fuzzyQuery).toContain('mcu');
  });

  it('treats drive/control/step/accelerate as action verbs for coreWords', () => {
    // drive/step/accelerate 是硬件动词,应优先成为 coreWords(coreWords 只取前 2 个动词)
    const r = parseQuery('drive step accelerate motor');
    // 前 2 个动词进 coreWords
    expect(r.coreWords).toContain('drive');
    expect(r.coreWords).toContain('step');
    // 第 3 个动词 accelerate 进 modifiers(动词优先,但 coreWords 只取前 2 个)
    expect(r.modifiers).toContain('accelerate');
  });
});
