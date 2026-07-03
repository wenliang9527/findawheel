// src/normalize/normalizer.ts
import type { RawResult, Wheel, WheelType } from './types.js';

function inferTypeFromTopics(topics: string[]): WheelType | null {
  const t = topics.map(s => s.toLowerCase());
  if (t.includes('cli')) return 'cli';
  if (t.includes('sdk')) return 'sdk';
  if (t.includes('api')) return 'api';
  return null;
}

export function normalize(raw: RawResult): Wheel {
  switch (raw.source) {
    case 'github': {
      const type = inferTypeFromTopics(raw.topics) ?? 'project';
      return {
        name: raw.name,
        source: 'github',
        url: raw.url,
        description: raw.description,
        type,
        metrics: {
          stars: raw.stars,
          lastUpdated: raw.pushedAt,
          license: raw.license ?? undefined,
          archived: raw.archived,
        },
      };
    }
    case 'npm':
      return {
        name: raw.name,
        source: 'npm',
        url: raw.url,
        description: raw.description,
        type: 'package',
        metrics: {
          lastUpdated: raw.date,
          ...(raw.stars !== undefined ? { stars: raw.stars } : {}),
          ...(raw.downloads !== undefined ? { downloads: raw.downloads } : {}),
        },
      };
    case 'crates':
      return {
        name: raw.name,
        source: 'crates',
        url: raw.url,
        description: raw.description,
        type: 'package',
        metrics: {
          lastUpdated: raw.updatedAt,
          downloads: raw.downloads,
          license: raw.license ?? undefined,
        },
      };
  }
}
