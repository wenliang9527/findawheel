// tests/normalize/normalizer.test.ts
import { describe, it, expect } from 'vitest';
import { normalize } from '../../src/normalize/normalizer.js';
import type { RawResult } from '../../src/normalize/types.js';

describe('normalize', () => {
  it('maps GitHub result with cli topic to cli type', () => {
    const raw: RawResult = {
      source: 'github',
      name: 'foo/cli',
      url: 'https://github.com/foo/cli',
      description: 'A CLI tool',
      stars: 50,
      language: 'Go',
      license: 'MIT',
      archived: false,
      pushedAt: '2025-06-01T00:00:00Z',
      topics: ['cli', 'tool'],
    };
    const wheel = normalize(raw);
    expect(wheel.type).toBe('cli');
    expect(wheel.metrics.stars).toBe(50);
    expect(wheel.metrics.license).toBe('MIT');
    expect(wheel.metrics.archived).toBe(false);
    expect(wheel.metrics.lastUpdated).toBe('2025-06-01T00:00:00Z');
  });

  it('maps GitHub result without special topics to project type', () => {
    const raw: RawResult = {
      source: 'github', name: 'foo/app', url: 'https://github.com/foo/app',
      description: 'd', stars: 0, language: null, license: null,
      archived: false, pushedAt: '2025-01-01T00:00:00Z', topics: [],
    };
    expect(normalize(raw).type).toBe('project');
  });

  it('maps npm result as package type', () => {
    const raw: RawResult = {
      source: 'npm', name: 'lodash', url: 'https://www.npmjs.com/package/lodash',
      description: 'utils', version: '4.17.21', keywords: ['utils'],
      date: '2024-01-01T00:00:00Z',
    };
    const w = normalize(raw);
    expect(w.type).toBe('package');
    expect(w.metrics.lastUpdated).toBe('2024-01-01T00:00:00Z');
    expect(w.metrics.stars).toBeUndefined();
  });

  it('maps crates result with downloads', () => {
    const raw: RawResult = {
      source: 'crates', name: 'serde', url: 'https://crates.io/crates/serde',
      description: 'ser', version: '1.0', downloads: 1000, recentDownloads: 100,
      updatedAt: '2025-05-01T00:00:00Z', license: 'MIT',
    };
    const w = normalize(raw);
    expect(w.type).toBe('package');
    expect(w.metrics.downloads).toBe(1000);
    expect(w.metrics.license).toBe('MIT');
  });

  it('handles archived github repo', () => {
    const raw: RawResult = {
      source: 'github', name: 'foo/old', url: '', description: '',
      stars: 0, language: null, license: null, archived: true,
      pushedAt: '2020-01-01T00:00:00Z', topics: [],
    };
    expect(normalize(raw).metrics.archived).toBe(true);
  });

  it('maps github-code result as snippet type with owner/repo#path name', () => {
    const raw: RawResult = {
      source: 'github-code',
      name: 'foo/bar',
      url: 'https://github.com/foo/bar/blob/main/src/parser.ts',
      path: 'src/parser.ts',
      description: 'A parser library',
      stars: 100,
      language: 'TypeScript',
      textFragment: 'function parse(input) { ... }',
      pushedAt: '2025-06-01T00:00:00Z',
    };
    const w = normalize(raw);
    expect(w.source).toBe('github-code');
    expect(w.type).toBe('snippet');
    expect(w.name).toBe('foo/bar#src/parser.ts');
    expect(w.metrics.stars).toBe(100);
    expect(w.metrics.lastUpdated).toBe('2025-06-01T00:00:00Z');
    // description 应拼接仓库描述 + 命中片段
    expect(w.description).toContain('parser library');
    expect(w.description).toContain('function parse');
  });

  it('maps github-code result without textFragment', () => {
    const raw: RawResult = {
      source: 'github-code',
      name: 'foo/baz',
      url: 'https://github.com/foo/baz/blob/main/x.ts',
      path: 'x.ts',
      description: 'only desc',
      stars: 0,
      language: null,
      pushedAt: '2025-01-01T00:00:00Z',
    };
    const w = normalize(raw);
    expect(w.description).toBe('only desc');
    expect(w.type).toBe('snippet');
  });

  it('maps vscode-marketplace result as extension type with installCount as downloads', () => {
    const raw: RawResult = {
      source: 'vscode-marketplace',
      name: 'ms-python.python',
      url: 'https://marketplace.visualstudio.com/items?itemName=ms-python.python',
      description: 'Python extension',
      installCount: 100000000,
      averageRating: 4.5,
      ratingCount: 1000,
      lastUpdated: '2025-06-01T00:00:00Z',
      publisher: 'ms-python',
    };
    const w = normalize(raw);
    expect(w.source).toBe('vscode-marketplace');
    expect(w.type).toBe('extension');
    expect(w.metrics.downloads).toBe(100000000);
    expect(w.metrics.lastUpdated).toBe('2025-06-01T00:00:00Z');
  });

  it('maps paperswithcode result as paper type', () => {
    const raw: RawResult = {
      source: 'paperswithcode',
      name: 'Attention Is All You Need',
      url: 'https://paperswithcode.com/paper/attention-is-all-you-need',
      description: 'The Transformer architecture',
      year: 2017,
      repoUrl: 'https://github.com/tensorflow/tensor2tensor',
      stars: 5000,
      area: 'sequence-modeling',
    };
    const w = normalize(raw);
    expect(w.source).toBe('paperswithcode');
    expect(w.type).toBe('paper');
    expect(w.metrics.stars).toBe(5000);
  });
});
