// tests/util/rateLimitCircuitBreaker.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('rateLimitCircuitBreaker', () => {
  // 模块内部状态是 module-level Map,无 reset/clear API。
  // 用 vi.resetModules() + 动态 import 让每个测试拿到全新模块实例(空 Map),
  // 配合 vi.useFakeTimers() 控制时间,避免跨测试状态泄漏与真实时间依赖。
  let markRateLimited: (source: string, resetAt: number) => void;
  let isRateLimited: (source: string) => boolean;
  let getRateLimitedSources: () => string[];

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const mod = await import('../../src/util/rateLimitCircuitBreaker.js');
    markRateLimited = mod.markRateLimited;
    isRateLimited = mod.isRateLimited;
    getRateLimitedSources = mod.getRateLimitedSources;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('isRateLimited returns false for never-marked source', () => {
    expect(isRateLimited('github')).toBe(false);
  });

  it('markRateLimited marks source as rate limited', () => {
    const futureTime = Date.now() + 60000; // 1 分钟后过期
    markRateLimited('github', futureTime);
    expect(isRateLimited('github')).toBe(true);
  });

  it('isRateLimited returns false after resetAt expires', () => {
    const now = Date.now();
    markRateLimited('github', now + 1000);
    expect(isRateLimited('github')).toBe(true);

    vi.advanceTimersByTime(1500); // 过期
    expect(isRateLimited('github')).toBe(false);
  });

  it('isRateLimited auto-cleans expired entries', () => {
    markRateLimited('github', Date.now() + 1000);
    vi.advanceTimersByTime(1500);
    // 过期后 isRateLimited 应清理并返回 false
    expect(isRateLimited('github')).toBe(false);
    // getRateLimitedSources 也不应包含过期源
    expect(getRateLimitedSources()).not.toContain('github');
  });

  it('getRateLimitedSources returns all currently-limited sources', () => {
    const future = Date.now() + 60000;
    markRateLimited('github', future);
    markRateLimited('gitee', future);
    const sources = getRateLimitedSources();
    expect(sources).toContain('github');
    expect(sources).toContain('gitee');
  });

  it('does not affect other sources', () => {
    markRateLimited('github', Date.now() + 60000);
    expect(isRateLimited('gitee')).toBe(false);
    expect(isRateLimited('gitlab')).toBe(false);
  });

  it('different sources have independent expiry', () => {
    markRateLimited('github', Date.now() + 10000); // 10s 后过期
    markRateLimited('gitee', Date.now() + 20000); // 20s 后过期

    vi.advanceTimersByTime(12000); // github 过期,gitee 未过期
    expect(isRateLimited('github')).toBe(false);
    expect(isRateLimited('gitee')).toBe(true);
  });

  it('markRateLimited updates resetAt if called again', () => {
    markRateLimited('github', Date.now() + 1000); // 1s 后过期
    markRateLimited('github', Date.now() + 60000); // 覆盖为 60s 后过期

    vi.advanceTimersByTime(2000); // 原本应过期,但被覆盖
    expect(isRateLimited('github')).toBe(true);
  });
});
