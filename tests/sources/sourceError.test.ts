// tests/sources/sourceError.test.ts
import { describe, it, expect } from 'vitest';
import { toSourceError } from '../../src/sources/sourceError.js';
import { HttpError } from '../../src/util/http.js';
import { SourceError, RateLimitError, ErrorCode } from '../../src/errors.js';

describe('toSourceError', () => {
  it('404 → SourceError with NOT_FOUND code', () => {
    const err = new HttpError(404, 'Not Found', 'https://example.com');
    const result = toSourceError('github', err);
    expect(result).toBeInstanceOf(SourceError);
    expect(result).not.toBeInstanceOf(RateLimitError);
    expect((result as SourceError).code).toBe(ErrorCode.NOT_FOUND);
    expect(result.message).toContain('not found');
  });

  it('401 → SourceError with UNAUTHORIZED code', () => {
    const err = new HttpError(401, 'Unauthorized', 'https://example.com');
    const result = toSourceError('github', err);
    expect((result as SourceError).code).toBe(ErrorCode.UNAUTHORIZED);
    expect(result.message).toContain('unauthorized');
  });

  it('403 → RateLimitError(默认 [403, 429])', () => {
    const err = new HttpError(403, 'Forbidden', 'https://example.com');
    const result = toSourceError('github', err);
    expect(result).toBeInstanceOf(RateLimitError);
    expect((result as RateLimitError).resetAt).toBeInstanceOf(Date);
  });

  it('429 → RateLimitError(默认 [403, 429])', () => {
    const err = new HttpError(429, 'Too Many Requests', 'https://example.com');
    const result = toSourceError('github', err);
    expect(result).toBeInstanceOf(RateLimitError);
  });

  it('500 → SourceError with SOURCE_FAILURE code', () => {
    const err = new HttpError(500, 'Internal Server Error', 'https://example.com');
    const result = toSourceError('github', err);
    expect(result).toBeInstanceOf(SourceError);
    expect((result as SourceError).code).toBe(ErrorCode.SOURCE_FAILURE);
    expect(result.message).toContain('HTTP 500');
  });

  it('自定义 rateLimitStatus 覆盖默认', () => {
    const err = new HttpError(429, 'Too Many', 'https://example.com');
    // gitlab 只把 429 视为 rate limit,403 视为普通错误
    const result = toSourceError('gitlab', err, { rateLimitStatus: [429] });
    expect(result).toBeInstanceOf(RateLimitError);
  });

  it('403 在 rateLimitStatus 不含 403 时不视为 RateLimitError', () => {
    const err = new HttpError(403, 'Forbidden', 'https://example.com');
    const result = toSourceError('gitlab', err, { rateLimitStatus: [429] });
    expect(result).not.toBeInstanceOf(RateLimitError);
    expect((result as SourceError).code).toBe(ErrorCode.SOURCE_FAILURE);
  });

  it('自定义 unauthorizedStatus 覆盖默认', () => {
    const err = new HttpError(403, 'Forbidden', 'https://example.com');
    // 某些源把 403 当作 unauthorized 而非 rate limit
    const result = toSourceError('special', err, {
      rateLimitStatus: [429],
      unauthorizedStatus: [401, 403],
    });
    expect((result as SourceError).code).toBe(ErrorCode.UNAUTHORIZED);
  });

  it('非 HttpError 的 Error → SourceError with SOURCE_FAILURE', () => {
    const err = new Error('network down');
    const result = toSourceError('github', err);
    expect(result).toBeInstanceOf(SourceError);
    expect((result as SourceError).code).toBe(ErrorCode.SOURCE_FAILURE);
    expect(result.message).toContain('network down');
  });

  it('字符串错误 → SourceError', () => {
    const result = toSourceError('npm', 'some string error');
    expect(result).toBeInstanceOf(SourceError);
    expect(result.message).toContain('some string error');
  });

  it('null 错误 → SourceError 不崩溃(P1-6 发现的 bug 已修)', () => {
    const result = toSourceError('npm', null);
    expect(result).toBeInstanceOf(SourceError);
    expect(result.message).toContain('[npm]');
  });

  it('undefined 错误 → SourceError 不崩溃', () => {
    const result = toSourceError('npm', undefined);
    expect(result).toBeInstanceOf(SourceError);
  });

  it('RateLimitError 的 resetAt 是未来时间', () => {
    const err = new HttpError(429, 'Too Many', 'https://example.com');
    const before = Date.now();
    const result = toSourceError('github', err);
    const after = Date.now();
    const resetAt = (result as RateLimitError).resetAt.getTime();
    // 默认 +1 小时,所以远大于 now
    expect(resetAt).toBeGreaterThan(after);
    expect(resetAt).toBeGreaterThanOrEqual(before + 3600 * 1000 - 100);
  });
});
