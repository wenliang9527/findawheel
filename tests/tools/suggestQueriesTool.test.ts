// tests/tools/suggestQueriesTool.test.ts
import { describe, it, expect } from 'vitest';
import { createSuggestQueriesTool } from '../../src/tools/suggestQueriesTool.js';

const tool = createSuggestQueriesTool();

async function run(query: string) {
  const res = await tool.handle({ query });
  const text = res.content[0].text;
  return JSON.parse(text);
}

describe('suggest_queries', () => {
  it('returns 4 query variants from different angles', async () => {
    const out = await run('AI coding assistant monitor status tracking');
    expect(out.suggestions).toHaveLength(4);
    const angles = out.suggestions.map((s: any) => s.angle);
    expect(angles).toEqual(['precise', 'action_oriented', 'fuzzy', 'concise']);
  });

  it('recommended is action_oriented (verb-first)', async () => {
    const out = await run('AI coding assistant monitor status tracking');
    // 动作导向搜索词应该包含 monitor(动词)
    expect(out.recommended).toContain('monitor');
    expect(out.reason).toContain('动词');
  });

  it('translates Chinese query to English', async () => {
    const out = await run('我想做AI串口监控工具');
    // translatedQuery 应该有英文
    expect(out.translatedQuery.length).toBeGreaterThan(0);
    // 至少一个建议应该是英文
    const hasEnglish = out.suggestions.some((s: any) => /[a-z]/i.test(s.query));
    expect(hasEnglish).toBe(true);
  });

  it('handles empty query', async () => {
    const res = await tool.handle({ query: '' });
    expect(res.isError).toBe(true);
  });

  it('each suggestion has query + description + when_to_use', async () => {
    const out = await run('pdf to markdown converter');
    for (const s of out.suggestions) {
      expect(s.query).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(s.when_to_use).toBeTruthy();
    }
  });

  it('action_oriented query includes format words', async () => {
    const out = await run('pdf to markdown converter');
    const action = out.suggestions.find((s: any) => s.angle === 'action_oriented');
    // pdf 和 markdown 是格式词,应该在 action_oriented 里
    expect(action.query).toContain('pdf');
    expect(action.query).toContain('markdown');
  });
});
