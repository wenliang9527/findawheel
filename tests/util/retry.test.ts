// tests/util/retry.test.ts
import { describe, it, expect, vi } from 'vitest';
import { withRetry, RetryableError } from '../../src/util/retry.js';

describe('withRetry', () => {
  it('returns value on first success without retry', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { retries: 2, baseMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('retries on RetryableError and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new RetryableError('network down'))
      .mockResolvedValueOnce('ok');
    const result = await withRetry(fn, { retries: 2, baseMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-retryable error (throws immediately)', async () => {
    const err = new Error('HTTP 404');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { retries: 2, baseMs: 10 })).rejects.toThrow('HTTP 404');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('throws after max retries exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new RetryableError('always fails'));
    await expect(withRetry(fn, { retries: 2, baseMs: 10 })).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('uses exponential backoff between retries', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new RetryableError('fail'))
      .mockResolvedValueOnce('ok');
    const sleepSpy = vi.spyOn(Promise, 'resolve');
    const start = Date.now();
    await withRetry(fn, { retries: 2, baseMs: 50 });
    const elapsed = Date.now() - start;
    // 至少等了 50ms 退避
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(sleepSpy).toHaveBeenCalled();
    sleepSpy.mockRestore();
  });
});
