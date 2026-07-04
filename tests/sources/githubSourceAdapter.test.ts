// tests/sources/githubSourceAdapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubSourceAdapter, buildGithubQuery } from '../../src/sources/githubSourceAdapter.js';
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

  it('wraps multi-word core phrase in quotes when parsedQuery provided', () => {
    // Phase 6 简化:统一逻辑,多词 corePhrase 加引号(不再有嵌入式特殊处理)
    const parsed = parseQuery('invisible image watermark encryption');
    const q = buildGithubQuery('invisible image watermark encryption', 'feature', undefined, parsed);
    // core phrase "invisible watermark" 应该被引号包裹
    expect(q).toContain('"invisible watermark"');
  });

  it('does NOT wrap single-word core phrase in quotes', () => {
    // 单词 corePhrase 不加引号
    const parsed = parseQuery('markdown');
    const q = buildGithubQuery('markdown', 'project', undefined, parsed);
    expect(q).toContain('markdown');
    expect(q).not.toContain('"markdown"');
  });

  // Phase 6 简化:删除反义词 NOT 子句测试(antonymExcludes 已删)
  // Phase 6 简化:删除嵌入式领域特殊逻辑测试(统一逻辑)

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
});

// 注:isAggregateRepo 已合并到 ranker.ts(AGGREGATE_NAME_PATTERNS + AGGREGATE_DESC_PATTERNS 集中管理)
// 聚合仓库过滤测试见 tests/rank/ranker.test.ts

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
