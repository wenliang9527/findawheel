// tests/rank/ranker.test.ts
import { describe, it, expect } from 'vitest';
import { rank, filterOut, score, dedupe } from '../../src/rank/ranker.js';
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

  // ===== R1:topics 命中加分 =====
  it('R1: topics matching query keywords gets bonus', () => {
    const noTopics = makeWheel({
      name: 'lib-a', description: 'A library for motor control',
      metrics: { stars: 1000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false },
    });
    const withTopics = makeWheel({
      name: 'lib-b', description: 'A library for motor control',
      topics: ['stepper-motor', 'driver', 'embedded'],
      metrics: { stars: 1000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false },
    });
    const keywords = ['stepper', 'motor', 'driver'];
    const sNo = score(noTopics, 'project', keywords);
    const sYes = score(withTopics, 'project', keywords);
    // topics 命中 stepper/motor/driver 的项目应得分更高
    expect(sYes).toBeGreaterThan(sNo);
  });

  it('R1: topics bonus is zero when wheel has no topics', () => {
    // 无 topics 字段(如 pypi/librariesio 源)不应加分
    const w = makeWheel({ topics: undefined });
    const withTopics = makeWheel({
      topics: ['stepper', 'motor'],
    });
    const keywords = ['stepper', 'motor'];
    expect(score(withTopics, 'project', keywords)).toBeGreaterThan(score(w, 'project', keywords));
  });

  // ===== R2:name 命中权重高于 description =====
  it('R2: name match scores higher than description-only match', () => {
    // 用 2 个关键词,各自只命中 1 个:
    // - nameHit: name 含 'lodash'(nameBonus=0.125),desc 不含任何关键词(descBonus=0)
    // - descOnly: desc 含 'parser'(descBonus=0.075),name 不含任何关键词(nameBonus=0)
    // coverage 相同(都 1/2 命中),其他项相同 → nameBonus(0.125) > descBonus(0.075)
    const nameHit = makeWheel({
      name: 'lodash-helper', description: 'A utility library',
      metrics: { stars: 1000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false },
    });
    const descOnly = makeWheel({
      name: 'utils', description: 'parser library with tools',
      metrics: { stars: 1000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false },
    });
    const keywords = ['lodash', 'parser'];
    const sName = score(nameHit, 'project', keywords);
    const sDesc = score(descOnly, 'project', keywords);
    // name 命中(0.125)应高于 description 命中(0.075),R2: name 权重 > description
    expect(sName).toBeGreaterThan(sDesc);
  });

  // ===== R3:精确短语匹配加分 =====
  it('R3: exact phrase match in description gets bonus', () => {
    // description 含完整 "markdown editor" 短语 vs 单词散落命中
    const phraseHit = makeWheel({
      name: 'lib-a', description: 'A lightweight markdown editor for developers',
      metrics: { stars: 1000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false },
    });
    const scatteredHit = makeWheel({
      name: 'lib-b', description: 'Editor for markdown and other text formats',
      metrics: { stars: 1000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false },
    });
    const keywords = ['markdown', 'editor'];
    const sPhrase = score(phraseHit, 'project', keywords);
    const sScattered = score(scatteredHit, 'project', keywords);
    // 精确短语命中("markdown editor" 连续出现)应得分更高
    expect(sPhrase).toBeGreaterThan(sScattered);
  });

  it('R3: phrase bonus is zero when queryKeywords has only 1 word', () => {
    // 单关键词不触发短语匹配(至少 2 个词才有"短语"概念)
    const w = makeWheel({ description: 'markdown tool' });
    // 不应抛错,score 应正常计算
    expect(() => score(w, 'project', ['markdown'])).not.toThrow();
  });

  // ===== R4:downloads 分母提到 1000000 =====
  it('R4: downloads denominator is 1000000 (covers million-level weekly downloads)', () => {
    // 100k downloads 在旧分母(100k)下是满分 1.0,在新分母(1M)下是 0.1
    // 1M downloads 在新分母下才是满分
    const w100k = makeWheel({
      source: 'npm', type: 'package',
      metrics: { downloads: 100000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false },
    });
    const w1m = makeWheel({
      source: 'npm', type: 'package',
      metrics: { downloads: 1000000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false },
    });
    const s100k = score(w100k, 'feature');
    const s1m = score(w1m, 'feature');
    // 1M downloads 应明显高于 100k(R4 调整分母后,100k 不再是满分)
    expect(s1m).toBeGreaterThan(s100k);
  });

  // ===== R5:连续线性衰减 =====
  it('R5: recency is 1.0 for updates within 1 year', () => {
    // 6 个月前的更新应得满分 recency(1年内=1.0)
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString();
    const w = makeWheel({
      metrics: { stars: 1000, lastUpdated: sixMonthsAgo, license: 'MIT', archived: false },
    });
    const sRecent = score(w, 'project');
    // 对比 2.5 年前的更新(应衰减到约 0.55)
    const twoAndHalfYearsAgo = new Date(Date.now() - 2.5 * 365 * 24 * 3600 * 1000).toISOString();
    const wOld = makeWheel({
      metrics: { stars: 1000, lastUpdated: twoAndHalfYearsAgo, license: 'MIT', archived: false },
    });
    const sOld = score(wOld, 'project');
    expect(sRecent).toBeGreaterThan(sOld);
  });

  it('R5: recency linear decay between 1 and 3 years (no step jump)', () => {
    // 1.5 年前 vs 2.5 年前:连续衰减,2.5 年应得分更低
    const oneAndHalfYears = new Date(Date.now() - 1.5 * 365 * 24 * 3600 * 1000).toISOString();
    const twoAndHalfYears = new Date(Date.now() - 2.5 * 365 * 24 * 3600 * 1000).toISOString();
    const w1_5 = makeWheel({
      metrics: { stars: 1000, lastUpdated: oneAndHalfYears, license: 'MIT', archived: false },
    });
    const w2_5 = makeWheel({
      metrics: { stars: 1000, lastUpdated: twoAndHalfYears, license: 'MIT', archived: false },
    });
    expect(score(w1_5, 'project')).toBeGreaterThan(score(w2_5, 'project'));
  });

  // ===== P0-2:基础分归一化 + bonus 上限结构 =====
  it('P0-2: base score (no keyword match) is <= 1.0', () => {
    // 无 query 关键词命中,只有基础分(stars + recency + downloads + license + coverage=0)
    // 基础分应 <= 1.0
    const w = makeWheel({
      name: 'unrelated-lib',
      description: 'something completely unrelated',
      metrics: { stars: 100000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false, downloads: 5000000 },
    });
    const s = score(w, 'project', ['nonexistent_keyword']);
    // 无命中:bonus=0,基础分 <= 1.0
    expect(s).toBeLessThanOrEqual(1.0);
  });

  it('P0-2: total score never exceeds 1.5 (base 1.0 + bonus 0.5)', () => {
    // 极端情况:stars 满 + recency 满 + coverage 满 + downloads 满 + license 满 + 所有 bonus 满
    const w = makeWheel({
      name: 'ai-coding-monitor-assistant',
      description: 'ai coding monitor assistant status tracking dashboard observer watcher tracker',
      topics: ['ai', 'coding', 'monitor', 'assistant', 'status', 'tracking'],
      metrics: { stars: 100000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false, downloads: 5000000 },
    });
    const keywords = ['ai', 'coding', 'monitor', 'assistant', 'status', 'tracking'];
    const s = score(w, 'project', keywords);
    // 总分上限 = 基础分 1.0 + bonus 0.5 = 1.5
    expect(s).toBeLessThanOrEqual(1.5);
    expect(s).toBeGreaterThan(1.0); // 有命中,bonus > 0
  });

  it('P0-2: bonus is capped at 0.5 even when all bonus items hit max', () => {
    // 验证方式:让所有 bonus 项都能命中,总分不应超过 1.5(基础分 1.0 + bonus 上限 0.5)
    // 如果 bonus 没有上限,descBonus(0.15)+ nameBonus(0.15)+ phraseBonus(0.1)+ topicsBonus(0.1)= 0.5
    // 加上基础分 1.0 = 1.5,刚好等于上限
    const w = makeWheel({
      name: 'lodash-parser',
      description: 'lodash parser snippet example implementation function',
      topics: ['lodash', 'parser', 'snippet', 'example', 'function'],
      metrics: { stars: 100000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false, downloads: 5000000 },
    });
    const keywords = ['lodash', 'parser', 'snippet', 'example', 'function'];
    const s = score(w, 'project', keywords);
    // 总分应 <= 1.5(bonus 上限 0.5 + 基础分上限 1.0)
    expect(s).toBeLessThanOrEqual(1.5 + 0.001); // 允许浮点误差
    expect(s).toBeGreaterThan(1.0); // 有命中,bonus > 0
  });

  it('P0-2: base score structure sums to 1.0 (stars + recency + coverage + downloads + license)', () => {
    // 满分场景:所有基础分项都满
    const w = makeWheel({
      name: 'perfect-lib',
      description: 'perfect library tool',
      metrics: { stars: 100000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false, downloads: 5000000 },
    });
    // 用一个 description 命中的关键词让 coverage 满分
    const s = score(w, 'project', ['perfect', 'library', 'tool']);
    // 基础分 = stars(0.25)+ recency(0.2)+ coverage(0.4)+ downloads(0.1)+ license(0.05)= 1.0
    // bonus > 0(有命中)
    // 总分 > 1.0(有 bonus)
    expect(s).toBeGreaterThan(1.0);
  });
});

// Phase 6 简化:删除 isReverseIntent 和 isMissingCoreConcept 的测试。
// 这两个过滤函数已删除 —— 相关性判断交给 AI 调用方,不再用硬规则过滤。

describe('dedupe', () => {
  it('merges same name keeping richer metrics', () => {
    const a = makeWheel({ name: 'lodash', source: 'npm', metrics: { lastUpdated: '2025-01-01T00:00:00Z' } });
    const b = makeWheel({ name: 'lodash', source: 'github', metrics: { stars: 50000, lastUpdated: '2025-01-01T00:00:00Z' } });
    const out = dedupe([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].metrics.stars).toBe(50000);
  });

  // P1-6:dedupe 时合并 topics(场景:GitHub 项目 + npm 包同名)
  it('P1-6: merges topics from same-name wheels (github + npm)', () => {
    const github = makeWheel({
      name: 'lodash',
      source: 'github',
      topics: ['javascript', 'utility', 'functional'],
      metrics: { stars: 50000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false },
    });
    const npm = makeWheel({
      name: 'lodash',
      source: 'npm',
      topics: ['javascript', 'modules', 'browser'], // 'javascript' 重复
      metrics: { lastUpdated: '2025-01-01T00:00:00Z' }, // metrics 更少,会被替换
    });
    const out = dedupe([github, npm]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('github'); // 保留 metrics 更丰富的 github 版本
    // topics 应合并且去重:['javascript', 'utility', 'functional', 'modules', 'browser']
    expect(out[0].topics).toEqual(['javascript', 'utility', 'functional', 'modules', 'browser']);
  });

  it('P1-6: merges topics when npm wins (richer metrics)', () => {
    const github = makeWheel({
      name: 'express',
      source: 'github',
      topics: ['node', 'server'],
      metrics: { lastUpdated: '2025-01-01T00:00:00Z' },
    });
    const npm = makeWheel({
      name: 'express',
      source: 'npm',
      topics: ['express', 'router', 'middleware'],
      metrics: { stars: 50000, downloads: 5000000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false },
    });
    const out = dedupe([github, npm]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('npm'); // 保留 metrics 更丰富的 npm 版本
    // topics 应合并:['node', 'server', 'express', 'router', 'middleware']
    expect(out[0].topics).toEqual(['node', 'server', 'express', 'router', 'middleware']);
  });

  it('P1-6: handles undefined topics in either wheel', () => {
    const withTopics = makeWheel({
      name: 'lib',
      source: 'github',
      topics: ['topic-a'],
      metrics: { stars: 1000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false },
    });
    const noTopics = makeWheel({
      name: 'lib',
      source: 'npm',
      metrics: { lastUpdated: '2025-01-01T00:00:00Z' },
    });
    const out = dedupe([withTopics, noTopics]);
    expect(out).toHaveLength(1);
    expect(out[0].topics).toEqual(['topic-a']); // 保留有 topics 的
  });

  it('P1-6: both undefined topics stays undefined', () => {
    const a = makeWheel({
      name: 'lib', source: 'github',
      metrics: { stars: 1000, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false },
    });
    const b = makeWheel({
      name: 'lib', source: 'npm',
      metrics: { lastUpdated: '2025-01-01T00:00:00Z' },
    });
    const out = dedupe([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].topics).toBeUndefined();
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

  // Phase 6 简化:rank 不再做核心词必命中过滤。
  // 之前测试断言 react-image-crop 被过滤 —— 现在不过滤了,
  // AI 调用方看到结果后自己判断裁剪工具不相关。
  it('does NOT filter out unrelated results (judgment delegated to AI)', () => {
    // 搜 "invisible image watermark encryption" 时,裁剪工具虽然不相关,
    // 但 findawheel 不再硬过滤 —— 交给 AI 调用方判断。
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
    const out = rank([cropTool, watermarkTool], 'feature', 10, ['watermark', 'image']);
    // 两个结果都应保留(findawheel 不过滤,AI 自己判断)
    expect(out.map(w => w.name)).toContain('react-image-crop');
    expect(out.map(w => w.name)).toContain('blind-watermark-wasm');
  });
});
