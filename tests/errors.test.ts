// tests/errors.test.ts
import { describe, it, expect } from 'vitest';
import { RateLimitError, SourceError } from '../src/errors.js';

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
});
