// tests/cache/cache.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCache, cacheKey } from '../../src/cache/cache.js';
import type { Wheel } from '../../src/normalize/types.js';
import * as fs from 'node:fs';
import { makeTmpDir } from '../tools/helpers.js';

// 每个用例用独立子目录,避免并行测试互相干扰
let tmpDir: string;

beforeEach(() => {
  tmpDir = makeTmpDir('findawheel-test');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const sampleWheel: Wheel = {
  name: 'owner/repo', source: 'github', url: 'https://github.com/owner/repo',
  description: 'test', type: 'project', metrics: { stars: 10 },
};

describe('cacheKey', () => {
  it('is deterministic for same inputs', () => {
    const k1 = cacheKey('markdown to pdf', 'feature', undefined, 10);
    const k2 = cacheKey('markdown to pdf', 'feature', undefined, 10);
    expect(k1).toBe(k2);
  });

  it('differs when intent changes', () => {
    const k1 = cacheKey('markdown to pdf', 'feature', undefined, 10);
    const k2 = cacheKey('markdown to pdf', 'project', undefined, 10);
    expect(k1).not.toBe(k2);
  });

  it('differs when ecosystem changes', () => {
    const k1 = cacheKey('http client', 'feature', 'js', 10);
    const k2 = cacheKey('http client', 'feature', 'rust', 10);
    expect(k1).not.toBe(k2);
  });
});

describe('createCache', () => {
  it('returns undefined when cache miss', async () => {
    const cache = createCache({ dir: tmpDir, ttlMs: 60000, enabled: true });
    expect(await cache.get('missing-key')).toBeUndefined();
  });

  it('writes and reads back', async () => {
    const cache = createCache({ dir: tmpDir, ttlMs: 60000, enabled: true });
    await cache.set('key-1', [sampleWheel]);
    expect(await cache.get('key-1')).toEqual([sampleWheel]);
  });

  it('returns undefined when expired (TTL)', async () => {
    const cache = createCache({ dir: tmpDir, ttlMs: 50, enabled: true });
    await cache.set('key-1', [sampleWheel]);
    // 真实等待过期
    await new Promise<void>(r => setTimeout(r, 100));
    expect(await cache.get('key-1')).toBeUndefined();
  });

  it('no-op when disabled', async () => {
    const cache = createCache({ dir: tmpDir, ttlMs: 60000, enabled: false });
    await cache.set('key-1', [sampleWheel]);
    expect(await cache.get('key-1')).toBeUndefined();
    // 不应写文件
    expect(fs.existsSync(`${tmpDir}/key-1.json`)).toBe(false);
  });

  describe('dedupe', () => {
    it('runs fn only once for concurrent calls with same key', async () => {
      const cache = createCache({ dir: tmpDir, ttlMs: 60000, enabled: true });
      const fn = vi.fn().mockImplementation(async () => {
        // 模拟异步工作
        await new Promise<void>(r => setTimeout(r, 50));
        return [sampleWheel];
      });
      // 3 个并发请求
      const [a, b, c] = await Promise.all([
        cache.dedupe('dup-key', fn),
        cache.dedupe('dup-key', fn),
        cache.dedupe('dup-key', fn),
      ]);
      expect(fn).toHaveBeenCalledOnce();
      expect(a).toEqual([sampleWheel]);
      expect(b).toEqual([sampleWheel]);
      expect(c).toEqual([sampleWheel]);
    });

    it('different keys run independently', async () => {
      const cache = createCache({ dir: tmpDir, ttlMs: 60000, enabled: true });
      const fn1 = vi.fn().mockResolvedValue([sampleWheel]);
      const fn2 = vi.fn().mockResolvedValue([]);
      await Promise.all([
        cache.dedupe('k1', fn1),
        cache.dedupe('k2', fn2),
      ]);
      expect(fn1).toHaveBeenCalledOnce();
      expect(fn2).toHaveBeenCalledOnce();
    });

    it('clears in-flight entry after completion (next call reruns)', async () => {
      const cache = createCache({ dir: tmpDir, ttlMs: 60000, enabled: true });
      const fn = vi.fn().mockResolvedValue([sampleWheel]);
      await cache.dedupe('k1', fn);
      await cache.dedupe('k1', fn);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('dedupe cleans up inFlight when fn rejects', async () => {
      const cache = createCache({ dir: tmpDir, ttlMs: 60000, enabled: true });
      const fn = vi.fn().mockRejectedValueOnce(new Error('boom'));
      await expect(cache.dedupe('reject-key', fn)).rejects.toThrow('boom');
      // 第二次调用应正常执行(inFlight 已清理)
      const fn2 = vi.fn().mockResolvedValue('ok');
      const result = await cache.dedupe('reject-key', fn2);
      expect(result).toBe('ok');
      expect(fn2).toHaveBeenCalledTimes(1);
    });

    it('dedupe propagates rejection to all concurrent callers', async () => {
      const cache = createCache({ dir: tmpDir, ttlMs: 60000, enabled: true });
      const fn = vi.fn().mockRejectedValue(new Error('shared-fail'));
      await Promise.all([
        expect(cache.dedupe('shared-key', fn)).rejects.toThrow('shared-fail'),
        expect(cache.dedupe('shared-key', fn)).rejects.toThrow('shared-fail'),
        expect(cache.dedupe('shared-key', fn)).rejects.toThrow('shared-fail'),
      ]);
      // 仍只执行一次(去重生效)
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
