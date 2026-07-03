import { describe, it, expect, beforeEach } from 'vitest';
import { readEnv } from '../../src/util/env.js';

describe('readEnv', () => {
  beforeEach(() => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.FINDAWHEEL_LIMIT;
    delete process.env.FINDAWHEEL_TIMEOUT_MS;
    delete process.env.FINDAWHEEL_LOG_LEVEL;
  });

  it('returns defaults when env vars absent', () => {
    const env = readEnv();
    expect(env.githubToken).toBeUndefined();
    expect(env.limit).toBe(10);
    expect(env.timeoutMs).toBe(8000);
    expect(env.logLevel).toBe('info');
  });

  it('parses numeric env vars', () => {
    process.env.FINDAWHEEL_LIMIT = '5';
    process.env.FINDAWHEEL_TIMEOUT_MS = '3000';
    const env = readEnv();
    expect(env.limit).toBe(5);
    expect(env.timeoutMs).toBe(3000);
  });

  it('falls back to default on invalid number', () => {
    process.env.FINDAWHEEL_LIMIT = 'not-a-number';
    const env = readEnv();
    expect(env.limit).toBe(10);
  });

  it('reads github token', () => {
    process.env.GITHUB_TOKEN = 'ghp_xxx';
    expect(readEnv().githubToken).toBe('ghp_xxx');
  });
});
