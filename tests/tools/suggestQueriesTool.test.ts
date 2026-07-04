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

  // ===== 硬件类 query 自动推荐 ecosystem =====
  // 场景:stepper/motor/servo 等库主要在 Arduino/C++ 生态,
  // 用 python/js 搜会漏掉 AccelStepper、Marlin 等主流库。

  it('recommends ecosystem=arduino for stepper motor query', async () => {
    const out = await run('stepper motor control');
    expect(out.recommendedEcosystem).toBe('arduino');
    expect(out.reason).toContain('硬件');
    expect(out.reason).toContain('arduino');
  });

  it('recommends ecosystem=arduino for explicit arduino query', async () => {
    const out = await run('arduino servo control');
    expect(out.recommendedEcosystem).toBe('arduino');
  });

  it('recommends ecosystem=cpp for esp32 query', async () => {
    const out = await run('esp32 wifi scanner');
    expect(out.recommendedEcosystem).toBe('cpp');
  });

  it('recommends ecosystem=cpp for stm32 query', async () => {
    const out = await run('stm32 hal driver');
    expect(out.recommendedEcosystem).toBe('cpp');
  });

  it('translates Chinese stepper query and recommends ecosystem', async () => {
    // 中文"步进电机"应翻译为 stepper-motor,识别为硬件类
    const out = await run('步进电机驱动器');
    expect(out.recommendedEcosystem).toBe('arduino');
    expect(out.translatedQuery.toLowerCase()).toContain('stepper');
  });

  it('does not override user-provided ecosystem', async () => {
    // 用户显式传 ecosystem=python,不应被硬件推荐覆盖
    const res = await tool.handle({ query: 'stepper motor', ecosystem: 'python' });
    const out = JSON.parse(res.content[0].text);
    expect(out.recommendedEcosystem).toBe('python');
    // reason 不应包含"检测到硬件类关键词"(因为用户已显式指定)
    expect(out.reason).not.toContain('检测到硬件类关键词');
  });

  it('does not recommend ecosystem for non-hardware query', async () => {
    // 普通非硬件 query 不应有 recommendedEcosystem
    const out = await run('pdf to markdown converter');
    expect(out.recommendedEcosystem).toBeUndefined();
  });

  it('recommendedEcosystem field is exposed in output schema', async () => {
    // 确认输出结构包含 recommendedEcosystem 字段(仅在硬件类 query 时出现)
    const out = await run('stepper motor control');
    expect(out).toHaveProperty('recommendedEcosystem');
  });
});
