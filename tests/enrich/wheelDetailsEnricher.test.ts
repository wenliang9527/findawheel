// tests/enrich/wheelDetailsEnricher.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock 两个 fetcher 模块,隔离测试 enrichDetails 的编排逻辑
vi.mock('../../src/enrich/readmeFetcher.js', () => ({
  fetchReadme: vi.fn(),
}));
vi.mock('../../src/enrich/releaseFetcher.js', () => ({
  fetchLatestRelease: vi.fn(),
}));

import { enrichDetails, type WheelDetails } from '../../src/enrich/wheelDetailsEnricher.js';
import { fetchReadme } from '../../src/enrich/readmeFetcher.js';
import { fetchLatestRelease } from '../../src/enrich/releaseFetcher.js';
import type { Wheel } from '../../src/normalize/types.js';

const ghWheel: Wheel = {
  name: 'owner/repo',
  source: 'github',
  url: 'https://github.com/owner/repo',
  description: 'a test repo',
  type: 'project',
  metrics: { stars: 100, license: 'MIT' },
};

const npmWheel: Wheel = {
  name: 'express',
  source: 'npm',
  url: 'https://www.npmjs.com/package/express',
  description: 'web framework',
  type: 'package',
  metrics: {},
};

const readmeWithCode = '# Title\n\n```bash\nnpm install pkg\n```\n\n```js\nconst x = require("pkg");\n```';

describe('enrichDetails', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('enriches GitHub wheel with readme + code examples + release', async () => {
    vi.mocked(fetchReadme).mockResolvedValue(readmeWithCode);
    vi.mocked(fetchLatestRelease).mockResolvedValue({
      tag: 'v1.0.0', publishedAt: '2024-01-01T00:00:00Z', name: 'Release 1',
    });
    const details = await enrichDetails(ghWheel, { timeoutMs: 1000 });
    expect(details).not.toBeNull();
    expect(details!.name).toBe('owner/repo');
    expect(details!.source).toBe('github');
    expect(details!.readmeSnippet).toContain('Title');
    expect(details!.codeExamples).toHaveLength(2);
    expect(details!.codeExamples[0].language).toBe('bash');
    expect(details!.release?.tag).toBe('v1.0.0');
    expect(details!.release?.name).toBe('Release 1');
  });

  it('returns null for non-GitHub source (no README API)', async () => {
    const details = await enrichDetails(npmWheel, { timeoutMs: 1000 });
    expect(details).toBeNull();
    expect(fetchReadme).not.toHaveBeenCalled();
    expect(fetchLatestRelease).not.toHaveBeenCalled();
  });

  it('tolerates fetchReadme failure (empty readmeSnippet, no codeExamples)', async () => {
    vi.mocked(fetchReadme).mockRejectedValue(new Error('network error'));
    vi.mocked(fetchLatestRelease).mockResolvedValue({
      tag: 'v2.0.0', publishedAt: '2024-02-01T00:00:00Z',
    });
    const details = await enrichDetails(ghWheel, { timeoutMs: 1000 });
    expect(details).not.toBeNull();
    expect(details!.readmeSnippet).toBe('');
    expect(details!.codeExamples).toEqual([]);
    expect(details!.release?.tag).toBe('v2.0.0');
  });

  it('omits release field when fetchLatestRelease returns null (404)', async () => {
    vi.mocked(fetchReadme).mockResolvedValue('readme');
    vi.mocked(fetchLatestRelease).mockResolvedValue(null);
    const details = await enrichDetails(ghWheel, { timeoutMs: 1000 });
    expect(details).not.toBeNull();
    expect(details!.release).toBeUndefined();
  });

  it('omits licenseCheck when userLicense not configured', async () => {
    vi.mocked(fetchReadme).mockResolvedValue('readme');
    vi.mocked(fetchLatestRelease).mockResolvedValue(null);
    const details = await enrichDetails(ghWheel, { timeoutMs: 1000 });
    expect(details!.licenseCheck).toBeUndefined();
  });

  it('includes licenseCheck when userLicense configured', async () => {
    vi.mocked(fetchReadme).mockResolvedValue('readme');
    vi.mocked(fetchLatestRelease).mockResolvedValue(null);
    // wheel license = MIT, user license = MIT -> compatible
    const details = await enrichDetails(ghWheel, { timeoutMs: 1000, userLicense: 'MIT' });
    expect(details!.licenseCheck).toBeDefined();
    expect(details!.licenseCheck!.compatible).toBe(true);
  });

  it('passes githubToken to both fetchers', async () => {
    vi.mocked(fetchReadme).mockResolvedValue('readme');
    vi.mocked(fetchLatestRelease).mockResolvedValue(null);
    await enrichDetails(ghWheel, { timeoutMs: 1000, githubToken: 'ghp_xxx' });
    expect(fetchReadme).toHaveBeenCalledWith('owner/repo', expect.objectContaining({ githubToken: 'ghp_xxx' }));
    expect(fetchLatestRelease).toHaveBeenCalledWith('owner/repo', expect.objectContaining({ githubToken: 'ghp_xxx' }));
  });

  it('parses repo from wheel.name in owner/repo format', async () => {
    vi.mocked(fetchReadme).mockResolvedValue('readme');
    vi.mocked(fetchLatestRelease).mockResolvedValue(null);
    await enrichDetails(ghWheel, { timeoutMs: 1000 });
    expect(fetchReadme).toHaveBeenCalledWith('owner/repo', expect.anything());
    expect(fetchLatestRelease).toHaveBeenCalledWith('owner/repo', expect.anything());
  });
});
