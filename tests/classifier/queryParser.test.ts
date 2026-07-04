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

  // ===== Phase 5 新增:嵌入式领域识别 =====

  it('detects embedded domain when query contains stepper', () => {
    const r = parseQuery('stepper motor driver');
    expect(r.domain).toBe('embedded');
  });

  it('detects embedded domain when query contains motor', () => {
    const r = parseQuery('dc motor control');
    expect(r.domain).toBe('embedded');
  });

  it('detects embedded domain when query contains arduino', () => {
    const r = parseQuery('arduino led blink');
    expect(r.domain).toBe('embedded');
  });

  it('detects embedded domain when query contains Chinese 电机', () => {
    const r = parseQuery('步进电机驱动');
    expect(r.domain).toBe('embedded');
  });

  it('detects embedded domain when query contains esp32/stm32/rp2040', () => {
    expect(parseQuery('esp32 wifi').domain).toBe('embedded');
    expect(parseQuery('stm32 hal').domain).toBe('embedded');
    expect(parseQuery('rp2040 pico').domain).toBe('embedded');
  });

  it('returns null domain for non-embedded query', () => {
    expect(parseQuery('markdown editor').domain).toBeNull();
    expect(parseQuery('image watermark').domain).toBeNull();
  });

  it('appends platform expansion words to fuzzyQuery for embedded domain', () => {
    const r = parseQuery('stepper motor driver');
    // fuzzyQuery 应该追加平台扩展词
    expect(r.fuzzyQuery).toContain('arduino');
    expect(r.fuzzyQuery).toContain('esp32');
    expect(r.fuzzyQuery).toContain('stm32');
    expect(r.fuzzyQuery).toContain('rp2040');
  });

  // ===== Phase 5 P4 新增:多领域识别 =====

  it('detects frontend domain when query contains react/vue', () => {
    expect(parseQuery('react component library').domain).toBe('frontend');
    expect(parseQuery('vue ui components').domain).toBe('frontend');
    expect(parseQuery('tailwind css').domain).toBe('frontend');
  });

  it('detects data-science domain when query contains pandas/jupyter', () => {
    expect(parseQuery('pandas dataframe analysis').domain).toBe('data-science');
    expect(parseQuery('jupyter notebook visualization').domain).toBe('data-science');
    expect(parseQuery('pytorch model training').domain).toBe('data-science');
  });

  it('detects devops domain when query contains docker/kubernetes', () => {
    expect(parseQuery('docker container orchestration').domain).toBe('devops');
    expect(parseQuery('kubernetes helm chart').domain).toBe('devops');
    expect(parseQuery('terraform infrastructure').domain).toBe('devops');
  });

  it('detects game domain when query contains unity/godot', () => {
    expect(parseQuery('unity game engine').domain).toBe('game');
    expect(parseQuery('godot shader').domain).toBe('game');
    expect(parseQuery('opengl physics engine').domain).toBe('game');
  });

  it('detects security domain when query contains pentest/vulnerability', () => {
    expect(parseQuery('pentest vulnerability scanner').domain).toBe('security');
    expect(parseQuery('ctf exploit tool').domain).toBe('security');
    expect(parseQuery('malware forensic').domain).toBe('security');
  });

  it('appends platform words to fuzzyQuery for frontend domain', () => {
    const r = parseQuery('react component library');
    expect(r.fuzzyQuery).toContain('react');
    expect(r.fuzzyQuery).toContain('vue');
    expect(r.fuzzyQuery).toContain('tailwind');
  });

  it('appends platform words to fuzzyQuery for data-science domain', () => {
    const r = parseQuery('pandas dataframe');
    expect(r.fuzzyQuery).toContain('python');
    expect(r.fuzzyQuery).toContain('jupyter');
    expect(r.fuzzyQuery).toContain('numpy');
  });

  it('detects Chinese 部署/运维 as devops domain', () => {
    expect(parseQuery('docker 部署工具').domain).toBe('devops');
    expect(parseQuery('运维 监控').domain).toBe('devops');
  });

  it('detects Chinese 游戏/引擎 as game domain', () => {
    expect(parseQuery('unity 游戏引擎').domain).toBe('game');
    expect(parseQuery('物理引擎 碰撞检测').domain).toBe('game');
  });

  it('detects Chinese 安全/漏洞 as security domain', () => {
    expect(parseQuery('安全漏洞扫描').domain).toBe('security');
    expect(parseQuery('渗透测试工具').domain).toBe('security');
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
