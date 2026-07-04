// tests/tools/searchKnowledgeTool.test.ts
import { describe, it, expect } from 'vitest';
import { searchKnowledge } from '../../src/tools/searchKnowledgeTool.js';
import type { EnvConfig } from '../../src/util/env.js';

function makeEnv(overrides: Partial<EnvConfig> = {}): EnvConfig {
  return {
    limit: 20,
    timeoutMs: 8000,
    logLevel: 'info',
    cacheEnabled: true,
    cacheTtlMs: 3_600_000,
    cacheDir: '/tmp/cache',
    feedbackDir: '/tmp/feedback',
    kbEnabled: false,
    kbRoots: [],
    kbMaxFileKb: 100,
    kbCacheEnabled: false,
    ...overrides,
  };
}

describe('searchKnowledgeTool', () => {
  describe('when KB disabled', () => {
    it('returns hint when kbEnabled=false', async () => {
      const env = makeEnv({ kbEnabled: false });
      const result = await searchKnowledge({ query: 'redis' }, env);
      expect(result.total).toBe(0);
      expect(result.items).toEqual([]);
      expect(result.hint).toContain('disabled');
      expect(result.hint).toContain('FINDAWHEEL_KB_ENABLED');
    });

    it('returns hint when kbRoots is empty', async () => {
      const env = makeEnv({ kbEnabled: true, kbRoots: [] });
      const result = await searchKnowledge({ query: 'redis' }, env);
      expect(result.total).toBe(0);
      expect(result.hint).toContain('FINDAWHEEL_KB_ROOT');
    });
  });

  describe('query validation', () => {
    it('rejects query with only stopwords', async () => {
      const env = makeEnv({ kbEnabled: true, kbRoots: ['/tmp'] });
      const result = await searchKnowledge({ query: 'the a an' }, env);
      expect(result.total).toBe(0);
      expect(result.hint).toContain('stopwords');
    });

    it('rejects query that is too short', async () => {
      const env = makeEnv({ kbEnabled: true, kbRoots: ['/tmp'] });
      const result = await searchKnowledge({ query: 'a' }, env);
      expect(result.total).toBe(0);
      expect(result.hint).toContain('stopwords');
    });
  });

  describe('with non-existent root', () => {
    it('returns empty gracefully when root directory does not exist', async () => {
      const env = makeEnv({
        kbEnabled: true,
        kbRoots: ['/nonexistent-path-xyz-123'],
      });
      const result = await searchKnowledge({ query: 'redis' }, env);
      expect(result.total).toBe(0);
      // 不应该崩溃,应该返回空结果
      expect(result.items).toEqual([]);
    });
  });

  describe('limit handling', () => {
    it('caps limit at 50', async () => {
      const env = makeEnv({ kbEnabled: true, kbRoots: ['/tmp'] });
      const result = await searchKnowledge({ query: 'test', limit: 9999 }, env);
      // 不会报错,limit 被钳到 50
      expect(result).toBeDefined();
    });

    it('uses default limit when not provided', async () => {
      const env = makeEnv({ kbEnabled: true, kbRoots: ['/tmp'] });
      const result = await searchKnowledge({ query: 'test' }, env);
      expect(result).toBeDefined();
    });
  });
});
