// tests/sources/githubSourceAdapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubSourceAdapter, buildGithubQuery, isAggregateRepo } from '../../src/sources/githubSourceAdapter.js';
import { parseQuery } from '../../src/classifier/queryParser.js';

describe('buildGithubQuery', () => {
  it('project intent searches name+description', () => {
    const q = buildGithubQuery('markdown editor', 'project', undefined);
    expect(q).toContain('in:name,description');
    expect(q).toContain('sort:stars');
  });

  it('feature intent includes readme', () => {
    const q = buildGithubQuery('parse pdf', 'feature', undefined);
    expect(q).toContain('in:name,description,readme');
  });

  it('adds language filter when ecosystem provided', () => {
    const q = buildGithubQuery('markdown editor', 'project', 'js');
    expect(q).toContain('language:JavaScript');
  });

  it('excludes awesome repos with NOT clause', () => {
    const q = buildGithubQuery('markdown editor', 'project', undefined);
    expect(q).toContain('NOT awesome in:name');
  });

  it('translates Chinese keywords to English', () => {
    const q = buildGithubQuery('图片水印', 'feature', undefined);
    expect(q).toContain('图片水印');
    expect(q).toContain('image');
    expect(q).toContain('watermark');
  });

  it('wraps core phrase in quotes when parsedQuery provided', () => {
    const parsed = parseQuery('invisible image watermark encryption');
    const q = buildGithubQuery('invisible image watermark encryption', 'feature', undefined, parsed);
    // core phrase "invisible watermark" 应该被引号包裹
    expect(q).toContain('"invisible watermark"');
  });

  it('adds NOT clauses for antonyms when parsedQuery provided', () => {
    const parsed = parseQuery('invisible image watermark');
    const q = buildGithubQuery('invisible image watermark', 'feature', undefined, parsed);
    // 反义词 remove/clean/strip 应该被 NOT 排除
    expect(q).toContain('NOT remove in:description');
    expect(q).toContain('NOT clean in:description');
  });

  // ===== Phase 5 新增:嵌入式领域搜索优化 =====

  it('does NOT wrap core phrase in quotes for embedded domain', () => {
    // 嵌入式领域只用 corePhrase 第一个词,不加引号:让 GitHub 做词干匹配
    const parsed = parseQuery('stepper motor driver');
    const q = buildGithubQuery('stepper motor driver', 'feature', undefined, parsed);
    // 不应包含引号包裹的 "stepper motor"
    expect(q).not.toContain('"stepper motor"');
    // 只用第一个词 stepper(避免 serial uart AND 搜索过滤掉主流库)
    expect(q).toContain('stepper');
  });

  it('excludes modifiers from searchTerms to avoid over-filtering', () => {
    // 嵌入式领域只用 corePhrase 第一个词,避免多词 AND 命中过严
    const parsed = parseQuery('stepper motor driver microcontroller');
    const q = buildGithubQuery('stepper motor driver microcontroller', 'project', undefined, parsed);
    // searchTerms 只用第一个词 stepper
    expect(q).toContain('stepper');
    // 修饰词 motor/driver/microcontroller 不进 searchTerms
    // 但 NOT awesome 等子句可以存在
  });

  it('uses only first word of corePhrase for embedded domain to avoid AND over-filtering', () => {
    // P8 新增:嵌入式领域 corePhrase="serial uart" 时,只搜 "serial"
    // 避免 node-serialport(description="...serial ports")因不含 uart 被过滤
    const parsed = parseQuery('serial port debug tool');
    expect(parsed.domain).toBe('embedded');
    const q = buildGithubQuery('serial port debug tool', 'project', undefined, parsed);
    // 应该只含 serial,不含 uart(避免 AND 搜索)
    expect(q).toContain('serial');
    // 不应含 "serial uart" 作为连续短语(GitHub 默认 AND 会要求两个词都命中)
    expect(q).not.toMatch(/serial\s+uart\s+in:name/);
  });

  it('still wraps core phrase in quotes for non-embedded domain', () => {
    // 非嵌入式领域保持引号短语(精确匹配)
    const parsed = parseQuery('invisible image watermark encryption');
    const q = buildGithubQuery('invisible image watermark encryption', 'feature', undefined, parsed);
    expect(q).toContain('"invisible watermark"');
  });

  it('adds cpp/arduino ecosystem language filter', () => {
    expect(buildGithubQuery('foo', 'project', 'cpp')).toContain('language:C++');
    expect(buildGithubQuery('foo', 'project', 'arduino')).toContain('language:Arduino');
  });

  it('does NOT add language filter for ecosystem=c (mixed C/C++/Arduino)', () => {
    // c 故意不映射:单片机 C 项目在 GitHub 上常被标记为 C/C++/Arduino,
    // 限制成单一语言会漏掉主流库
    const q = buildGithubQuery('stepper motor', 'project', 'c');
    expect(q).not.toContain('language:');
  });

  // ===== Phase 5 P7 新增:embedded 领域不加 language 限制 =====

  it('does NOT add language filter for embedded domain even with ecosystem=ts', () => {
    // 嵌入式领域语言混杂,即使传 ecosystem=ts 也不加 language 限制
    // 例:node-serialport(8.5k stars)是 JavaScript,用户传 ecosystem=ts 会漏掉
    const parsed = parseQuery('serial port debug tool');
    expect(parsed.domain).toBe('embedded');
    const q = buildGithubQuery('serial port debug tool', 'project', 'ts', parsed);
    expect(q).not.toContain('language:');
  });

  it('does NOT add language filter for embedded domain even with ecosystem=cpp', () => {
    // Serial-Studio(3k stars)是 C++,用户传 ecosystem=cpp 时也不应限制
    const parsed = parseQuery('stepper motor driver');
    expect(parsed.domain).toBe('embedded');
    const q = buildGithubQuery('stepper motor driver', 'project', 'cpp', parsed);
    expect(q).not.toContain('language:');
  });

  it('still adds language filter for non-embedded domain with ecosystem=ts', () => {
    // 非嵌入式领域应该正常加 language 限制
    const parsed = parseQuery('react component library');
    expect(parsed.domain).toBe('frontend');
    const q = buildGithubQuery('react component library', 'project', 'ts', parsed);
    expect(q).toContain('language:TypeScript');
  });
});

describe('isAggregateRepo', () => {
  it('detects awesome-xxx repos', () => {
    expect(isAggregateRepo('awesome-python', 'A curated list')).toBe(true);
  });
  it('detects public-apis repos', () => {
    expect(isAggregateRepo('public-apis', 'Collective list of APIs')).toBe(true);
  });
  it('does not flag normal repos', () => {
    expect(isAggregateRepo('lodash', 'A utility library')).toBe(false);
  });
});

describe('GitHubSourceAdapter.search', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('parses GitHub response into RawResult[]', async () => {
    const fakeResponse = {
      total_count: 1,
      items: [{
        full_name: 'owner/repo',
        html_url: 'https://github.com/owner/repo',
        description: 'A markdown editor',
        stargazers_count: 100,
        language: 'TypeScript',
        license: { spdx_id: 'MIT' },
        archived: false,
        pushed_at: '2025-01-01T00:00:00Z',
        topics: ['editor'],
      }],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fakeResponse,
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new GitHubSourceAdapter();
    const results = await adapter.search('markdown editor', {
      intent: 'project', timeoutMs: 1000,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      source: 'github',
      name: 'owner/repo',
      url: 'https://github.com/owner/repo',
      description: 'A markdown editor',
      stars: 100,
      language: 'TypeScript',
      license: 'MIT',
      archived: false,
      pushedAt: '2025-01-01T00:00:00Z',
      topics: ['editor'],
    });
    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.pathname).toBe('/search/repositories');
  });

  it('throws RateLimitError on 403 with rate-limit header', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1735689600' }),
      text: async () => 'rate limited',
    } as unknown as Response));
    const adapter = new GitHubSourceAdapter();
    await expect(adapter.search('x', { intent: 'project', timeoutMs: 1000 }))
      .rejects.toThrow(/rate limited/i);
  });
});
