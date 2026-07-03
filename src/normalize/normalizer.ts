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
    case 'gitee':
      return {
        name: raw.name,
        source: 'gitee',
        url: raw.url,
        description: raw.description,
        type: 'project',
        metrics: {
          stars: raw.stars,
          lastUpdated: raw.updatedAt,
          license: raw.license ?? undefined,
        },
      };
    case 'gitlab': {
      const type = inferTypeFromTopics(raw.topics) ?? 'project';
      return {
        name: raw.name,
        source: 'gitlab',
        url: raw.url,
        description: raw.description,
        type,
        metrics: {
          stars: raw.stars,
          lastUpdated: raw.lastActivityAt,
          archived: raw.archived,
        },
      };
    }
    case 'pypi':
      return {
        name: raw.name,
        source: 'pypi',
        url: raw.url,
        description: raw.description,
        type: 'package',
        metrics: {},
      };
    case 'librariesio':
      return {
        name: raw.name,
        source: 'librariesio',
        url: raw.url,
        description: raw.description,
        type: 'package',
        metrics: {
          stars: raw.stars,
          ...(raw.lastUpdated ? { lastUpdated: raw.lastUpdated } : {}),
        },
      };
    case 'web':
      return {
        name: raw.name,
        source: 'web',
        url: raw.url,
        description: raw.description,
        type: 'project', // 网页结果默认归类为 project(可能是工具站/教程/博客)
        metrics: {},
      };
  }
}
