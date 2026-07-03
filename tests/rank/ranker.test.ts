// tests/rank/ranker.test.ts
import { describe, it, expect } from 'vitest';
import { rank, filterOut, score, dedupe, isReverseIntent, isMissingCoreConcept } from '../../src/rank/ranker.js';
import type { Wheel } from '../../src/normalize/types.js';

function makeWheel(over: Partial<Wheel> = {}): Wheel {
  return {
    name: 'x', source: 'github', url: 'https://github.com/x/x',
    description: 'desc', type: 'project',
    metrics: { stars: 100, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false },
    ...over,
  };
}

describe('filterOut', () => {
  it('removes archived', () => {
    const w = makeWheel({ metrics: { archived: true } });
    expect(filterOut(w)).toBe(true);
  });
  it('removes lastUpdated older than 3 years', () => {
    const w = makeWheel({ metrics: { lastUpdated: '2020-01-01T00:00:00Z' } });
    expect(filterOut(w)).toBe(true);
  });
  it('removes empty description with stars < 10', () => {
    const w = makeWheel({ description: '', metrics: { stars: 5 } });
    expect(filterOut(w)).toBe(true);
  });
  it('keeps active repo with description', () => {
    expect(filterOut(makeWheel())).toBe(false);
  });
  it('removes awesome-xxx aggregate repos', () => {
    const w = makeWheel({ name: 'awesome-python', description: 'A curated list of Python packages' });
    expect(filterOut(w)).toBe(true);
  });
  it('removes public-apis aggregate repos', () => {
    const w = makeWheel({ name: 'public-apis', description: 'A collective list of free APIs' });
    expect(filterOut(w)).toBe(true);
  });
});

describe('score', () => {
  it('higher stars scores higher', () => {
    const low = score(makeWheel({ metrics: { stars: 10 } }), 'project');
    const high = score(makeWheel({ metrics: { stars: 30000 } }), 'project');
    expect(high).toBeGreaterThan(low);
  });
  it('feature intent boosts downloads weight', () => {
    const w = makeWheel({ source: 'crates', type: 'package', metrics: { downloads: 80000 } });
    const f = score(w, 'feature');
    const p = score(w, 'project');
    expect(f).toBeGreaterThan(p);
  });
  it('description matching query keywords gets bonus', () => {
    const noMatch = makeWheel({ description: 'A file upload library', metrics: { stars: 1000 } });
    const match = makeWheel({ description: 'Image watermark tool', name: 'watermark', metrics: { stars: 1000 } });
    const sNo = score(noMatch, 'project', ['image', 'watermark']);
    const sYes = score(match, 'project', ['image', 'watermark']);
    expect(sYes).toBeGreaterThan(sNo);
  });
  it('higher query coverage scores higher', () => {
    // 全词覆盖率高的项目应排在覆盖率低的前面
    const lowCoverage = makeWheel({ description: 'A watermark library', metrics: { stars: 1000 } });
    const highCoverage = makeWheel({ description: 'Add invisible watermark to images with encryption', metrics: { stars: 1000 } });
    const sLow = score(lowCoverage, 'project', ['invisible', 'watermark', 'encryption', 'image']);
    const sHigh = score(highCoverage, 'project', ['invisible', 'watermark', 'encryption', 'image']);
    expect(sHigh).toBeGreaterThan(sLow);
  });
  it('zero-hit high-star project is penalized', () => {
    // voicebox 场景:高 star 但零命中,应被降权,排不过低 star 但命中的项目
    const zeroHitHighStar = makeWheel({
      name: 'voicebox', description: 'The open-source AI voice studio',
      metrics: { stars: 37000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false },
    });
    const hitLowStar = makeWheel({
      name: 'ai-monitor', description: 'Monitor AI coding assistant status',
      metrics: { stars: 100, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false },
    });
    const keywords = ['ai', 'coding', 'monitor', 'status', 'tracking'];
    const sZero = score(zeroHitHighStar, 'feature', keywords);
    const sHit = score(hitLowStar, 'feature', keywords);
    expect(sHit).toBeGreaterThan(sZero);
  });
});

describe('isReverseIntent', () => {
  const antonyms = ['remove', 'clean', 'strip'];
  it('flags "remove watermark" result when user wants watermark', () => {
    const w = makeWheel({ description: 'Remove invisible watermarks from images' });
    expect(isReverseIntent(w, antonyms, ['watermark', 'image'])).toBe(true);
  });
  it('flags "watermark remover" result', () => {
    const w = makeWheel({ description: 'A watermark remover tool' });
    expect(isReverseIntent(w, antonyms, ['watermark'])).toBe(true);
  });
  it('does not flag result that just contains "remove" without watermark', () => {
    const w = makeWheel({ description: 'Remove duplicate entries from arrays' });
    expect(isReverseIntent(w, antonyms, ['watermark'])).toBe(false);
  });
  it('does not flag when antonymExcludes is empty', () => {
    const w = makeWheel({ description: 'Remove watermarks' });
    expect(isReverseIntent(w, [], ['watermark'])).toBe(false);
  });
  it('does not flag when query has no action word', () => {
    const w = makeWheel({ description: 'Remove files quickly' });
    expect(isReverseIntent(w, antonyms, ['files'])).toBe(false);
  });
});

describe('isMissingCoreConcept', () => {
  // 核心动作词,来自 parseQuery('invisible image watermark encryption') 的 coreWords
  const coreWords = ['invisible', 'watermark'];

  it('flags result whose description lacks any core word', () => {
    // 裁剪工具既无 invisible 也无 watermark,应被剔除
    const w = makeWheel({ name: 'react-image-crop', description: 'A responsive image cropping tool' });
    expect(isMissingCoreConcept(w, coreWords)).toBe(true);
  });
  it('keeps result whose description contains a core word', () => {
    const w = makeWheel({ description: 'Add invisible watermark to images' });
    expect(isMissingCoreConcept(w, coreWords)).toBe(false);
  });
  it('keeps result whose name (not description) contains a core word', () => {
    // 包名命中也算,避免描述简短但包名精准的工具被误杀
    const w = makeWheel({ name: 'blind-watermark-wasm', description: 'A WASM library' });
    expect(isMissingCoreConcept(w, coreWords)).toBe(false);
  });
  it('skips filtering when coreWords is empty', () => {
    // 纯项目级 query 无核心词,跳过本规则
    const w = makeWheel({ description: 'A generic tool' });
    expect(isMissingCoreConcept(w, [])).toBe(false);
  });
  it('does NOT count modifier words as core', () => {
    // 修饰词 encryption/resistant 不在 coreWords 里,描述里只有修饰词不算命中
    const w = makeWheel({ description: 'encryption resistant helper', name: 'helper' });
    expect(isMissingCoreConcept(w, coreWords)).toBe(true);
  });
  it('case-insensitive match', () => {
    const w = makeWheel({ description: 'Add WATERMARK to image' });
    expect(isMissingCoreConcept(w, coreWords)).toBe(false);
  });

  // --- 格式词测试 ---
  it('flags result that lacks any format word from query', () => {
    // query 含 pdf/markdown,但结果是 HTML 转换器,应被剔除
    const formatWords = ['pdf', 'markdown'];
    const w = makeWheel({ name: 'asciidoc-converter', description: 'Converts AsciiDoc to HTML' });
    expect(isMissingCoreConcept(w, [], formatWords)).toBe(true);
  });
  it('keeps result that contains a format word from query', () => {
    const formatWords = ['pdf', 'markdown'];
    const w = makeWheel({ name: 'pdf2md', description: 'Convert PDF to Markdown' });
    expect(isMissingCoreConcept(w, [], formatWords)).toBe(false);
  });
  it('skips format filtering when formatWords is empty', () => {
    // 无格式词的 query 不触发格式过滤
    const w = makeWheel({ description: 'A generic tool' });
    expect(isMissingCoreConcept(w, [], [])).toBe(false);
  });
  it('core AND format both checked (must hit at least one of each)', () => {
    // 核心词和格式词是 AND 关系:两个条件都要满足
    const coreWords = ['converter'];
    const formatWords = ['pdf', 'markdown'];
    // 命中核心词但没命中格式词 → 剔除
    const w1 = makeWheel({ description: 'A converter for HTML' });
    expect(isMissingCoreConcept(w1, coreWords, formatWords)).toBe(true);
    // 命中格式词但没命中核心词 → 剔除
    const w2 = makeWheel({ description: 'A pdf parser' });
    expect(isMissingCoreConcept(w2, coreWords, formatWords)).toBe(true);
    // 两个都命中 → 保留
    const w3 = makeWheel({ description: 'A converter from pdf to markdown' });
    expect(isMissingCoreConcept(w3, coreWords, formatWords)).toBe(false);
  });
});

describe('dedupe', () => {
  it('merges same name keeping richer metrics', () => {
    const a = makeWheel({ name: 'lodash', source: 'npm', metrics: { lastUpdated: '2025-01-01T00:00:00Z' } });
    const b = makeWheel({ name: 'lodash', source: 'github', metrics: { stars: 50000, lastUpdated: '2025-01-01T00:00:00Z' } });
    const out = dedupe([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].metrics.stars).toBe(50000);
  });
});

describe('rank', () => {
  it('filters then sorts by score desc and applies limit', () => {
    const bad = makeWheel({ name: 'bad', metrics: { archived: true } });
    const good = makeWheel({ name: 'good', metrics: { stars: 40000 } });
    const mid = makeWheel({ name: 'mid', metrics: { stars: 100 } });
    const out = rank([bad, mid, good], 'project', 10);
    expect(out.map(w => w.name)).toEqual(['good', 'mid']);
  });
  it('removes results missing core concept (react-image-crop should be filtered)', () => {
    // 模拟真实场景:搜 "invisible image watermark encryption" 时,
    // 高 star 的裁剪工具不应排在 watermark 工具前面
    const cropTool = makeWheel({
      name: 'react-image-crop',
      description: 'A responsive image cropping tool',
      metrics: { stars: 30000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false },
    });
    const watermarkTool = makeWheel({
      name: 'blind-watermark-wasm',
      description: 'Add invisible watermark to images',
      metrics: { stars: 500, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false },
    });
    const coreWords = ['invisible', 'watermark'];
    const out = rank([cropTool, watermarkTool], 'feature', 10, ['watermark', 'image'], [], coreWords);
    expect(out.map(w => w.name)).not.toContain('react-image-crop');
    expect(out.map(w => w.name)).toContain('blind-watermark-wasm');
  });
});
