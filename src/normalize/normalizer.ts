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
        topics: raw.topics,
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
        topics: raw.keywords,
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
        topics: raw.topics,
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
    case 'github-code':
      return {
        // name 用 owner/repo#path 形式,既唯一又能体现归属
        name: `${raw.name}#${raw.path}`,
        source: 'github-code',
        url: raw.url,
        // description 拼接仓库描述 + 命中片段,便于 Ranker 关键词匹配
        description: raw.textFragment
          ? `${raw.description} ${raw.textFragment}`.trim()
          : raw.description,
        type: 'snippet',
        metrics: {
          stars: raw.stars,
          lastUpdated: raw.pushedAt,
        },
      };
    case 'vscode-marketplace':
      return {
        name: raw.name,
        source: 'vscode-marketplace',
        url: raw.url,
        description: raw.description,
        type: 'extension',
        metrics: {
          // 安装数映射到 downloads,复用现有评分逻辑
          downloads: raw.installCount,
          lastUpdated: raw.lastUpdated,
        },
      };
    case 'paperswithcode':
      return {
        name: raw.name,
        source: 'paperswithcode',
        url: raw.url,
        description: raw.description,
        type: 'paper',
        metrics: {
          // stars 字段适配器暂未填充(paperswithcode API 不直接返回,需额外查关联 repo)
          // 留作未来扩展:若后续补充 repo stars 抓取,此处自动生效
          ...(raw.stars !== undefined ? { stars: raw.stars } : {}),
        },
      };
    case 'huggingface':
      return {
        name: raw.name,
        source: 'huggingface',
        url: raw.url,
        description: raw.description,
        type: 'model',
        metrics: {
          stars: raw.stars,
          downloads: raw.downloads,
          lastUpdated: raw.lastUpdated || undefined,
        },
      };
  }
}
