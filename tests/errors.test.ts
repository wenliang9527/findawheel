// tests/errors.test.ts
import { describe, it, expect } from 'vitest';
import { RateLimitError, SourceError, ErrorCode } from '../src/errors.js';

describe('errors', () => {
  it('RateLimitError carries resetAt', () => {
    const reset = new Date('2026-01-01T00:00:00Z');
    const err = new RateLimitError('github', reset);
    expect(err).toBeInstanceOf(SourceError);
    expect(err.source).toBe('github');
    expect(err.resetAt).toBe(reset);
    expect(err.message).toContain('github');
  });

  it('SourceError carries source name', () => {
    const err = new SourceError('npm', 'network down');
    expect(err.source).toBe('npm');
    expect(err.message).toContain('npm');
    expect(err.message).toContain('network down');
  });

  it('SourceError defaults to SOURCE_FAILURE code', () => {
    const err = new SourceError('npm', 'oops');
    expect(err.code).toBe(ErrorCode.SOURCE_FAILURE);
  });

  it('RateLimitError has RATE_LIMIT code', () => {
    // 子类应覆盖默认 code,标识自己为限流错误
    const err = new RateLimitError('github', new Date());
    expect(err.code).toBe(ErrorCode.RATE_LIMIT);
  });

  it('SourceError allows custom code for non-default categories', () => {
    // 调用方可显式传 code 区分 NOT_FOUND / UNAUTHORIZED 等细类
    const notFound = new SourceError('github', 'repo 404', ErrorCode.NOT_FOUND);
    expect(notFound.code).toBe(ErrorCode.NOT_FOUND);
    const unauth = new SourceError('gitlab', 'token invalid', ErrorCode.UNAUTHORIZED);
    expect(unauth.code).toBe(ErrorCode.UNAUTHORIZED);
  });
});
