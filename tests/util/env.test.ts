import { describe, it, expect, beforeEach } from 'vitest';
import { readEnv } from '../../src/util/env.js';

describe('readEnv', () => {
  beforeEach(() => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.EXA_API_KEY;
    delete process.env.TAVILY_API_KEY;
    delete process.env.GITLAB_TOKEN;
    delete process.env.LIBRARIES_IO_API_KEY;
    delete process.env.FINDAWHEEL_USER_LICENSE;
    delete process.env.FINDAWHEEL_LIMIT;
    delete process.env.FINDAWHEEL_TIMEOUT_MS;
    delete process.env.FINDAWHEEL_LOG_LEVEL;
    delete process.env.FINDAWHEEL_CACHE_ENABLED;
    delete process.env.FINDAWHEEL_CACHE_TTL_MS;
  });

  it('returns defaults when env vars absent', () => {
    const env = readEnv();
    expect(env.githubToken).toBeUndefined();
    expect(env.limit).toBe(20);
    expect(env.timeoutMs).toBe(8000);
    expect(env.logLevel).toBe('info');
    expect(env.cacheEnabled).toBe(true); // 默认开启
    expect(env.cacheTtlMs).toBe(3600000); // 1 小时
    expect(env.cacheDir).toMatch(/findawheel[/\\]cache$/);
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
    expect(env.limit).toBe(20);
  });

  it('reads github token', () => {
    process.env.GITHUB_TOKEN = 'ghp_xxx';
    expect(readEnv().githubToken).toBe('ghp_xxx');
  });

  it('reads gitlab token', () => {
    process.env.GITLAB_TOKEN = 'glpat_xxx';
    expect(readEnv().gitlabToken).toBe('glpat_xxx');
  });

  it('reads libraries.io api key', () => {
    process.env.LIBRARIES_IO_API_KEY = 'lib_key';
    expect(readEnv().librariesIoApiKey).toBe('lib_key');
  });

  it('reads user license', () => {
    process.env.FINDAWHEEL_USER_LICENSE = 'MIT';
    expect(readEnv().userLicense).toBe('MIT');
  });

  it('userLicense defaults to undefined when env var absent', () => {
    expect(readEnv().userLicense).toBeUndefined();
  });

  it('respects FINDAWHEEL_CACHE_ENABLED=false', () => {
    process.env.FINDAWHEEL_CACHE_ENABLED = 'false';
    expect(readEnv().cacheEnabled).toBe(false);
  });

  it('respects FINDAWHEEL_CACHE_ENABLED=true', () => {
    process.env.FINDAWHEEL_CACHE_ENABLED = 'true';
    expect(readEnv().cacheEnabled).toBe(true);
  });

  it('parses FINDAWHEEL_CACHE_TTL_MS', () => {
    process.env.FINDAWHEEL_CACHE_TTL_MS = '600000';
    expect(readEnv().cacheTtlMs).toBe(600000);
  });

  it('respects FINDAWHEEL_CACHE_DIR override', () => {
    process.env.FINDAWHEEL_CACHE_DIR = '/custom/cache';
    expect(readEnv().cacheDir).toBe('/custom/cache');
  });
});
