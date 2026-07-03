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
});
