// tests/tools/getWheelDetailsTool.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';

vi.mock('../../src/enrich/wheelDetailsEnricher.js', () => ({
  enrichDetails: vi.fn(),
}));

import { createGetWheelDetailsTool } from '../../src/tools/getWheelDetailsTool.js';
import { enrichDetails } from '../../src/enrich/wheelDetailsEnricher.js';
import { createCache } from '../../src/cache/cache.js';
import type { WheelDetails } from '../../src/enrich/wheelDetailsEnricher.js';
import { makeTmpDir } from './helpers.js';

const sampleDetails: WheelDetails = {
  name: 'owner/repo',
  source: 'github',
  url: 'https://github.com/owner/repo',
  readmeSnippet: '# Title',
  codeExamples: [{ language: 'bash', code: 'npm install' }],
  release: { tag: 'v1.0.0', publishedAt: '2024-01-01T00:00:00Z' },
};

let tmpDir: string;

beforeEach(() => {
  vi.restoreAllMocks();
  tmpDir = makeTmpDir('findawheel-details-test');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('getWheelDetailsTool.handle', () => {
  it('returns details from enrichDetails on cache miss', async () => {
    vi.mocked(enrichDetails).mockResolvedValue(sampleDetails);
    const cache = createCache({ dir: tmpDir, ttlMs: 60000, enabled: true });
    const tool = createGetWheelDetailsTool({
      cache, enrichOpts: { timeoutMs: 1000 },
    });
    const result = await tool.handle({ name: 'owner/repo' });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.name).toBe('owner/repo');
    expect(payload.readmeSnippet).toBe('# Title');
    expect(payload.release.tag).toBe('v1.0.0');
    expect(payload.cached).toBeUndefined();
    expect(enrichDetails).toHaveBeenCalledOnce();
  });

  it('returns cached details with cached:true on cache hit (no enrichDetails call)', async () => {
    vi.mocked(enrichDetails).mockResolvedValue(sampleDetails);
    const cache = createCache({ dir: tmpDir, ttlMs: 60000, enabled: true });
    const tool = createGetWheelDetailsTool({
      cache, enrichOpts: { timeoutMs: 1000 },
    });
    // 第一次:缓存未命中,抓取并写缓存
    await tool.handle({ name: 'owner/repo' });
    // 第二次:缓存命中
    const result = await tool.handle({ name: 'owner/repo' });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.cached).toBe(true);
    expect(enrichDetails).toHaveBeenCalledOnce(); // 只调了一次
  });

  it('rejects name without slash (invalid format)', async () => {
    const tool = createGetWheelDetailsTool({
      enrichOpts: { timeoutMs: 1000 },
    });
    const result = await tool.handle({ name: 'invalid-name' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/owner\/repo/i);
  });

  it('returns error when enrichDetails returns null (non-GitHub)', async () => {
    vi.mocked(enrichDetails).mockResolvedValue(null);
    const tool = createGetWheelDetailsTool({
      enrichOpts: { timeoutMs: 1000 },
    });
    const result = await tool.handle({ name: 'owner/repo' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/no details/i);
  });

  it('writes details to cache after successful enrich', async () => {
    vi.mocked(enrichDetails).mockResolvedValue(sampleDetails);
    const cache = createCache({ dir: tmpDir, ttlMs: 60000, enabled: true });
    const tool = createGetWheelDetailsTool({
      cache, enrichOpts: { timeoutMs: 1000 },
    });
    await tool.handle({ name: 'owner/repo' });
    // 验证缓存文件已写入
    const files = fs.readdirSync(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.json$/);
  });

  it('does not cache on enrichDetails failure (null)', async () => {
    vi.mocked(enrichDetails).mockResolvedValue(null);
    const cache = createCache({ dir: tmpDir, ttlMs: 60000, enabled: true });
    const tool = createGetWheelDetailsTool({
      cache, enrichOpts: { timeoutMs: 1000 },
    });
    await tool.handle({ name: 'owner/repo' });
    // 失败不写缓存
    const files = fs.existsSync(tmpDir) ? fs.readdirSync(tmpDir) : [];
    expect(files).toHaveLength(0);
  });

  it('passes enrichOpts (githubToken, userLicense) to enrichDetails', async () => {
    vi.mocked(enrichDetails).mockResolvedValue(sampleDetails);
    const tool = createGetWheelDetailsTool({
      enrichOpts: { timeoutMs: 5000, githubToken: 'ghp_xxx', userLicense: 'MIT' },
    });
    await tool.handle({ name: 'owner/repo' });
    expect(enrichDetails).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'owner/repo', source: 'github' }),
      expect.objectContaining({ timeoutMs: 5000, githubToken: 'ghp_xxx', userLicense: 'MIT' }),
    );
  });
});
