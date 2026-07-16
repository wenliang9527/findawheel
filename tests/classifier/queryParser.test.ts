// tests/classifier/queryParser.test.ts
import { describe, it, expect } from 'vitest';
import { parseQuery } from '../../src/classifier/queryParser.js';

describe('parseQuery', () => {
  it('extracts core phrase from first 2 content words', () => {
    const r = parseQuery('invisible image watermark encryption');
    // corePhrase 用前 2 个实义词(image 作为核心对象词不再被停用词过滤)
    expect(r.corePhrase).toBe('invisible image');
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
    // 用 package/project 仍是停用词,避免被当成核心对象词
    const r = parseQuery('a package for project');
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
    const r = parseQuery('a package for markdown');
    // 'a' 'for' 'package' are stopwords, core = 'markdown' (only 1 content word left)
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

  // ===== Q1:ecosystem 自动识别 =====
  it('Q1: detects python ecosystem from "python 库"', () => {
    // python 和 库 需相邻(正则 [\s_-]* 不跨中文字符)
    const r = parseQuery('python 库 数据处理');
    expect(r.ecosystem).toBe('python');
  });

  it('Q1: detects js ecosystem from "js package"', () => {
    const r = parseQuery('js framework for ui');
    expect(r.ecosystem).toBe('js');
  });

  it('Q1: detects rust ecosystem from "rust crate"', () => {
    const r = parseQuery('rust crate for parsing');
    expect(r.ecosystem).toBe('rust');
  });

  it('Q1: detects go ecosystem from "go module"', () => {
    const r = parseQuery('go module for concurrency');
    expect(r.ecosystem).toBe('go');
  });

  it('Q1: detects js ecosystem from "npm 包"', () => {
    const r = parseQuery('npm 包 打包工具');
    expect(r.ecosystem).toBe('js');
  });

  it('Q1: detects python ecosystem from "pypi 包"', () => {
    const r = parseQuery('pypi 包 数据处理');
    expect(r.ecosystem).toBe('python');
  });

  it('Q1: detects ts ecosystem from "typescript library"', () => {
    const r = parseQuery('typescript library for validation');
    expect(r.ecosystem).toBe('ts');
  });

  it('Q1: returns undefined when no ecosystem pattern matches', () => {
    const r = parseQuery('image watermark tool');
    expect(r.ecosystem).toBeUndefined();
  });

  it('Q1: detects rust ecosystem from "cargo crate"', () => {
    const r = parseQuery('cargo crate for serialization');
    expect(r.ecosystem).toBe('rust');
  });

  // ===== Q3:复合词拆分 =====
  it('Q3: splits hyphenated compound words (image-watermark)', () => {
    const r = parseQuery('image-watermark removal');
    // 拆分后 expandedQuery 应包含独立的 "watermark"(而非 "image-watermark")
    // 因为 splitCompoundWords 把 image-watermark → image watermark
    expect(r.expandedQuery.toLowerCase()).toContain('watermark');
    expect(r.expandedQuery.toLowerCase()).toContain('image');
  });

  it('Q3: splits underscore compound words (serial_port)', () => {
    const r = parseQuery('serial_port monitor');
    // 拆分后应包含独立的 "serial" 和 "port"
    expect(r.expandedQuery.toLowerCase()).toContain('serial');
    expect(r.expandedQuery.toLowerCase()).toContain('port');
  });

  it('Q3: splits slash compound words (image/watermark)', () => {
    const r = parseQuery('image/watermark detection');
    expect(r.expandedQuery.toLowerCase()).toContain('image');
    expect(r.expandedQuery.toLowerCase()).toContain('watermark');
  });

  it('Q3: compound word split enables keyword matching', () => {
    // 拆分后 coreWords 应该能从拆出的词里选动词
    // "serial-port" 拆为 serial + port,serial 不是动词,但能进入 allWords
    const r = parseQuery('serial-port debug tool');
    // 至少应该包含 serial 或 port 之一在结果里
    const allWords = [...r.coreWords, ...r.modifiers];
    expect(allWords.some(w => ['serial', 'port', 'debug'].includes(w))).toBe(true);
  });

  // ===== Q2:意图触发词剥离 =====
  it('Q2: strips intent trigger "build" from core words', () => {
    // "build a serial monitor" → build 是意图词,应被剥离,不进入 coreWords
    const r = parseQuery('build serial monitor');
    expect(r.coreWords).not.toContain('build');
    expect(r.coreWords).toContain('monitor'); // monitor 是动词,应保留
  });

  it('Q2: strips intent trigger "想做" from core words', () => {
    // "想做 串口调试" → 想做 是意图词,应被剥离
    const r = parseQuery('想做 串口调试');
    expect(r.coreWords).not.toContain('想做');
  });

  it('Q2: strips intent trigger "create" from core words', () => {
    const r = parseQuery('create pdf converter');
    expect(r.coreWords).not.toContain('create');
    // convert 是动词,但这里是 converter;converter 在 ACTION_VERBS 里
    expect(r.coreWords).toContain('converter');
  });

  it('Q2: keeps substantive words when intent triggers are stripped', () => {
    const r = parseQuery('i want to build a markdown editor');
    // want/build 是意图词,应被剥离;markdown/editor 是实质词应保留
    expect(r.coreWords).not.toContain('want');
    expect(r.coreWords).not.toContain('build');
    // editor 不是动词,但可能进 coreWords(如果没其他动词)
    // 至少 expandedQuery 应包含 markdown 和 editor
    expect(r.expandedQuery.toLowerCase()).toContain('markdown');
    expect(r.expandedQuery.toLowerCase()).toContain('editor');
  });

  // ===== Q5/Q6:翻译表和同义词表扩展验证 =====
  it('Q5: translates 协议/消息队列/异步 to English', () => {
    expect(parseQuery('协议').expandedQuery).toContain('protocol');
    expect(parseQuery('消息队列').expandedQuery).toContain('message-queue');
    expect(parseQuery('异步').expandedQuery).toContain('async');
  });

  it('Q5: translates 鉴权/授权/令牌 to English', () => {
    expect(parseQuery('鉴权').expandedQuery).toContain('auth');
    expect(parseQuery('授权').expandedQuery).toContain('authorization');
    expect(parseQuery('令牌').expandedQuery).toContain('jwt');
  });

  it('Q5: translates 部署/编排/微服务 to English', () => {
    expect(parseQuery('部署').expandedQuery).toContain('deploy');
    expect(parseQuery('编排').expandedQuery).toContain('orchestration');
    expect(parseQuery('微服务').expandedQuery).toContain('microservice');
  });

  it('Q6: fuzzyQuery uses synonyms for state/cache/websocket', () => {
    // SYNONYMS.state[0]='store', cache[0]='redis', websocket[0]='ws'(fuzzyQuery 取 syns[0])
    const r = parseQuery('state cache websocket');
    expect(r.fuzzyQuery).toContain('store');
    expect(r.fuzzyQuery).toContain('redis');
    expect(r.fuzzyQuery).toContain('ws');
  });
});
