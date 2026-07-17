import { describe, it, expect, beforeEach } from 'vitest';
import { readEnv } from '../../src/util/env.js';

describe('readEnv', () => {
  beforeEach(() => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.EXA_API_KEY;
    delete process.env.TAVILY_API_KEY;
    delete process.env.GITLAB_TOKEN;
    delete process.env.GITEE_TOKEN;
    delete process.env.LIBRARIES_IO_API_KEY;
    delete process.env.FINDAWHEEL_USER_LICENSE;
    delete process.env.FINDAWHEEL_LIMIT;
    delete process.env.FINDAWHEEL_TIMEOUT_MS;
    delete process.env.FINDAWHEEL_LOG_LEVEL;
    delete process.env.FINDAWHEEL_CACHE_ENABLED;
    delete process.env.FINDAWHEEL_CACHE_TTL_MS;
    delete process.env.FINDAWHEEL_CACHE_DIR;
    delete process.env.FINDAWHEEL_FEEDBACK_DIR;
    delete process.env.FINDAWHEEL_KB_ENABLED;
    delete process.env.FINDAWHEEL_KB_ROOT;
    delete process.env.FINDAWHEEL_KB_MAX_FILE_KB;
    delete process.env.FINDAWHEEL_KB_CACHE_ENABLED;
  });

  it('returns defaults when env vars absent', () => {
    const env = readEnv();
    expect(env.githubToken).toBeUndefined();
    expect(env.exaApiKey).toBeUndefined();
    expect(env.tavilyApiKey).toBeUndefined();
    expect(env.giteeToken).toBeUndefined();
    expect(env.limit).toBe(50);
    expect(env.timeoutMs).toBe(8000);
    expect(env.logLevel).toBe('info');
    expect(env.cacheEnabled).toBe(true); // 默认开启
    expect(env.cacheTtlMs).toBe(3600000); // 1 小时
    expect(env.cacheDir).toMatch(/findawheel[/\\]cache$/);
    expect(env.feedbackDir).toMatch(/findawheel[/\\]feedback$/);
    // KB 默认关闭
    expect(env.kbEnabled).toBe(false);
    expect(env.kbRoots).toEqual([]);
    expect(env.kbMaxFileKb).toBe(100);
    expect(env.kbCacheEnabled).toBe(false);
  });

  it('reads custom feedback dir', () => {
    process.env.FINDAWHEEL_FEEDBACK_DIR = '/custom/feedback';
    expect(readEnv().feedbackDir).toBe('/custom/feedback');
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
    expect(env.limit).toBe(50);
  });

  it('reads github token', () => {
    process.env.GITHUB_TOKEN = 'ghp_xxx';
    expect(readEnv().githubToken).toBe('ghp_xxx');
  });

  it('reads gitlab token', () => {
    process.env.GITLAB_TOKEN = 'glpat_xxx';
    expect(readEnv().gitlabToken).toBe('glpat_xxx');
  });

  it('reads gitee token', () => {
    process.env.GITEE_TOKEN = 'gitee_token_xxx';
    expect(readEnv().giteeToken).toBe('gitee_token_xxx');
  });

  it('reads exa api key', () => {
    process.env.EXA_API_KEY = 'exa-key-xxx';
    expect(readEnv().exaApiKey).toBe('exa-key-xxx');
  });

  it('reads tavily api key', () => {
    process.env.TAVILY_API_KEY = 'tvly-key-xxx';
    expect(readEnv().tavilyApiKey).toBe('tvly-key-xxx');
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

  it('respects FINDAWHEEL_LOG_LEVEL=debug', () => {
    process.env.FINDAWHEEL_LOG_LEVEL = 'debug';
    expect(readEnv().logLevel).toBe('debug');
  });

  it('falls back to info on invalid log level', () => {
    process.env.FINDAWHEEL_LOG_LEVEL = 'verbose';
    expect(readEnv().logLevel).toBe('info');
  });

  describe('knowledge base env vars', () => {
    it('FINDAWHEEL_KB_ENABLED=true enables KB', () => {
      process.env.FINDAWHEEL_KB_ENABLED = 'true';
      expect(readEnv().kbEnabled).toBe(true);
    });

    it('FINDAWHEEL_KB_ENABLED=false disables KB', () => {
      process.env.FINDAWHEEL_KB_ENABLED = 'false';
      expect(readEnv().kbEnabled).toBe(false);
    });

    it('FINDAWHEEL_KB_ENABLED=1 enables KB (truthy)', () => {
      process.env.FINDAWHEEL_KB_ENABLED = '1';
      expect(readEnv().kbEnabled).toBe(true);
    });

    it('FINDAWHEEL_KB_ENABLED=yes enables KB (truthy)', () => {
      process.env.FINDAWHEEL_KB_ENABLED = 'yes';
      expect(readEnv().kbEnabled).toBe(true);
    });

    it('FINDAWHEEL_KB_ROOT parses single root', () => {
      process.env.FINDAWHEEL_KB_ROOT = '/home/user/notes';
      expect(readEnv().kbRoots).toEqual(['/home/user/notes']);
    });

    it('FINDAWHEEL_KB_ROOT parses multiple comma-separated roots', () => {
      process.env.FINDAWHEEL_KB_ROOT = '/path/a, /path/b, /path/c';
      expect(readEnv().kbRoots).toEqual(['/path/a', '/path/b', '/path/c']);
    });

    it('FINDAWHEEL_KB_ROOT trims whitespace and filters empty', () => {
      process.env.FINDAWHEEL_KB_ROOT = '  /path/a  ,  , /path/b  ';
      expect(readEnv().kbRoots).toEqual(['/path/a', '/path/b']);
    });

    it('FINDAWHEEL_KB_ROOT empty string returns empty array', () => {
      process.env.FINDAWHEEL_KB_ROOT = '';
      expect(readEnv().kbRoots).toEqual([]);
    });

    it('FINDAWHEEL_KB_MAX_FILE_KB parses custom value', () => {
      process.env.FINDAWHEEL_KB_MAX_FILE_KB = '512';
      expect(readEnv().kbMaxFileKb).toBe(512);
    });

    it('FINDAWHEEL_KB_MAX_FILE_KB falls back to 100 on invalid', () => {
      process.env.FINDAWHEEL_KB_MAX_FILE_KB = 'not-a-number';
      expect(readEnv().kbMaxFileKb).toBe(100);
    });

    it('FINDAWHEEL_KB_CACHE_ENABLED=true enables KB cache', () => {
      process.env.FINDAWHEEL_KB_CACHE_ENABLED = 'true';
      expect(readEnv().kbCacheEnabled).toBe(true);
    });

    it('FINDAWHEEL_KB_CACHE_ENABLED defaults to false', () => {
      expect(readEnv().kbCacheEnabled).toBe(false);
    });
  });
});
