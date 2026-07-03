// tests/enrich/metricsEnricher.test.ts
import { describe, it, expect } from 'vitest';
import { enrich, inferActivity } from '../../src/enrich/metricsEnricher.js';

describe('inferActivity', () => {
  it('returns high when updated within 6 months', () => {
    const recent = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    expect(inferActivity(recent)).toBe('high');
  });
  it('returns medium when within 2 years', () => {
    const d = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
    expect(inferActivity(d)).toBe('medium');
  });
  it('returns low when older or undefined', () => {
    const old = new Date('2020-01-01T00:00:00Z').toISOString();
    expect(inferActivity(old)).toBe('low');
    expect(inferActivity(undefined)).toBe('low');
  });
});

describe('enrich', () => {
  it('sets activity based on lastUpdated', () => {
    const recent = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const w = enrich({
      name: 'x', source: 'github', url: '', description: '', type: 'project',
      metrics: { lastUpdated: recent },
    });
    expect(w.metrics.activity).toBe('high');
  });
  it('does not overwrite existing fields', () => {
    const w = enrich({
      name: 'x', source: 'npm', url: '', description: '', type: 'package',
      metrics: { stars: 10 },
    });
    expect(w.metrics.stars).toBe(10);
    expect(w.metrics.activity).toBe('low'); // no lastUpdated
  });
});
