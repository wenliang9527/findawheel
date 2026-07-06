// tests/sources/mavenSourceAdapter.test.ts
// Maven Central 适配器测试
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MavenSourceAdapter } from '../../src/sources/mavenSourceAdapter.js';
import type { SearchOpts } from '../../src/sources/sourceAdapter.js';

// mock httpGet(与 huggingfaceSourceAdapter.test.ts 同款模式)
vi.mock('../../src/util/http.js', () => ({
  httpGet: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, public url: string, body: string) {
      super(`HTTP ${status}`);
    }
    get retryable(): boolean { return this.status >= 500; }
  },
}));

import { httpGet, HttpError } from '../../src/util/http.js';

const baseOpts: SearchOpts = {
  intent: 'project',
  timeoutMs: 5000,
};

describe('MavenSourceAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('返回 Maven 坐标结果,含 name/url/version/repository', async () => {
    const mockResponse = {
      response: {
        docs: [
          {
            id: 'org.springframework.boot:spring-boot-starter-web',
            g: 'org.springframework.boot',
            a: 'spring-boot-starter-web',
            latestVersion: '3.2.0',
            repositoryId: 'central',
            timestamp: 1701234567890,
          },
        ],
      },
    };
    vi.mocked(httpGet).mockResolvedValue(mockResponse);

    const adapter = new MavenSourceAdapter();
    const results = await adapter.search('spring boot web', baseOpts);

    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('maven');
    expect(results[0].name).toBe('org.springframework.boot:spring-boot-starter-web');
    expect(results[0].url).toBe(
      'https://central.sonatype.com/artifact/org.springframework.boot/spring-boot-starter-web',
    );
    expect(results[0].version).toBe('3.2.0');
    expect(results[0].description).toBe('');
    expect((results[0] as any).repository).toBe('central');
    // timestamp 1701234567890ms → ISO
    expect((results[0] as any).lastUpdated).toBe(new Date(1701234567890).toISOString());
  });

  it('多个结果时全部映射', async () => {
    const mockResponse = {
      response: {
        docs: [
          {
            id: 'org.slf4j:slf4j-api',
            g: 'org.slf4j',
            a: 'slf4j-api',
            latestVersion: '2.0.9',
            repositoryId: 'central',
            timestamp: 1690000000000,
          },
          {
            id: 'ch.qos.logback:logback-classic',
            g: 'ch.qos.logback',
            a: 'logback-classic',
            latestVersion: '1.4.11',
            repositoryId: 'central',
            timestamp: 1680000000000,
          },
        ],
      },
    };
    vi.mocked(httpGet).mockResolvedValue(mockResponse);

    const adapter = new MavenSourceAdapter();
    const results = await adapter.search('logging', baseOpts);

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('org.slf4j:slf4j-api');
    expect(results[1].name).toBe('ch.qos.logback:logback-classic');
  });

  it('空结果时返回空数组', async () => {
    vi.mocked(httpGet).mockResolvedValue({ response: { docs: [] } });

    const adapter = new MavenSourceAdapter();
    const results = await adapter.search('nonexistent', baseOpts);

    expect(results).toEqual([]);
  });

  it('response 或 docs 缺失时容错为空数组', async () => {
    // 异常情况:API 返回了不完整结构
    vi.mocked(httpGet).mockResolvedValue({});

    const adapter = new MavenSourceAdapter();
    const results = await adapter.search('test', baseOpts);

    expect(results).toEqual([]);
  });

  it('timestamp 缺失时 lastUpdated 为 undefined', async () => {
    const mockResponse = {
      response: {
        docs: [
          {
            id: 'com.google.guava:guava',
            g: 'com.google.guava',
            a: 'guava',
            latestVersion: '32.1.1-jre',
            repositoryId: 'central',
            // 缺少 timestamp
          },
        ],
      },
    };
    vi.mocked(httpGet).mockResolvedValue(mockResponse);

    const adapter = new MavenSourceAdapter();
    const results = await adapter.search('guava', baseOpts);

    expect((results[0] as any).lastUpdated).toBeUndefined();
  });

  it('HTTP 错误时抛 SourceError', async () => {
    vi.mocked(httpGet).mockRejectedValue(
      new HttpError(500, 'https://search.maven.org/solrsearch/select', 'server error'),
    );

    const adapter = new MavenSourceAdapter();
    await expect(adapter.search('test', baseOpts)).rejects.toThrow();
  });

  it('URL 含 q/rows/wt 参数', async () => {
    vi.mocked(httpGet).mockResolvedValue({ response: { docs: [] } });

    const adapter = new MavenSourceAdapter();
    await adapter.search('spring boot', baseOpts);

    const calledUrl = vi.mocked(httpGet).mock.calls[0][0] as string;
    const parsed = new URL(calledUrl);
    expect(parsed.pathname).toBe('/solrsearch/select');
    expect(parsed.searchParams.get('q')).toBe('spring boot');
    expect(parsed.searchParams.get('rows')).toBe('20');
    expect(parsed.searchParams.get('wt')).toBe('json');
  });

  it('中文 query 被翻译为英文(追加到原 query)', async () => {
    vi.mocked(httpGet).mockResolvedValue({ response: { docs: [] } });

    const adapter = new MavenSourceAdapter();
    // "图片水印" → translateQuery 返回 "图片水印 image watermark"
    await adapter.search('图片水印', baseOpts);

    const calledUrl = vi.mocked(httpGet).mock.calls[0][0] as string;
    const q = new URL(calledUrl).searchParams.get('q') ?? '';
    // 翻译后应包含 image 和 watermark
    expect(q).toMatch(/image/);
    expect(q).toMatch(/watermark/);
    // 原中文也保留(用于命中中文 README 的包)
    expect(q).toContain('图片水印');
  });
});
