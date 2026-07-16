// src/normalize/normalizer.ts
import type { RawResult, Wheel, WheelSource, WheelType } from './types.js';
import { GITHUB_CODE_PATH_SEP } from './types.js';

function inferTypeFromTopics(topics: string[]): WheelType | null {
  const t = topics.map(s => s.toLowerCase());
  if (t.includes('cli')) return 'cli';
  if (t.includes('sdk')) return 'sdk';
  if (t.includes('api')) return 'api';
  return null;
}

/**
 * 单个 source 的归一化函数:把该 source 的 RawResult 转换为标准 Wheel。
 * 参数类型用 any 是为了让原 switch case 内的字段访问逻辑(依赖 discriminated union 收窄)
 * 可以原样移入,无需在每个 normalizer 内重复 type assertion。
 */
type Normalizer = (raw: any) => Wheel;

/**
 * source → Normalizer 注册表。
 * 用 Record<WheelSource, Normalizer> 而非 switch:
 * - 编译期强制所有 WheelSource 都注册(漏写某个 source 会在 typecheck 阶段报错)
 * - 新增 source 只需在此处追加一个键值对,无需修改 normalize 函数(开闭原则)
 */
const normalizers: Record<WheelSource, Normalizer> = {
  github: (raw) => {
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
  },
  npm: (raw) => ({
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
  }),
  crates: (raw) => ({
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
  }),
  gitee: (raw) => ({
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
  }),
  gitlab: (raw) => {
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
  },
  pypi: (raw) => ({
    name: raw.name,
    source: 'pypi',
    url: raw.url,
    description: raw.description,
    type: 'package',
    metrics: {
      ...(raw.stars !== undefined ? { stars: raw.stars } : {}),
    },
  }),
  librariesio: (raw) => ({
    name: raw.name,
    source: 'librariesio',
    url: raw.url,
    description: raw.description,
    type: 'package',
    metrics: {
      stars: raw.stars,
      ...(raw.lastUpdated ? { lastUpdated: raw.lastUpdated } : {}),
    },
  }),
  web: (raw) => ({
    name: raw.name,
    source: 'web',
    url: raw.url,
    description: raw.description,
    type: 'project', // 网页结果默认归类为 project(可能是工具站/教程/博客)
    metrics: {},
  }),
  'github-code': (raw) => ({
    // name 用 owner/repo#path 形式,既唯一又能体现归属
    name: `${raw.name}${GITHUB_CODE_PATH_SEP}${raw.path}`,
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
  }),
  'vscode-marketplace': (raw) => ({
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
  }),
  paperswithcode: (raw) => ({
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
  }),
  huggingface: (raw) => ({
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
  }),
  maven: (raw) => ({
    name: raw.name,
    source: 'maven',
    url: raw.url,
    description: raw.description,
    type: 'package',
    metrics: {
      ...(raw.lastUpdated ? { lastUpdated: raw.lastUpdated } : {}),
    },
  }),
  rubygems: (raw) => ({
    name: raw.name,
    source: 'rubygems',
    url: raw.url,
    description: raw.description,
    type: 'package',
    metrics: {
      downloads: raw.downloads,
      lastUpdated: raw.updatedAt,
      ...(raw.license ? { license: raw.license } : {}),
    },
  }),
  gopkg: (raw) => ({
    name: raw.name,
    source: 'gopkg',
    url: raw.url,
    description: raw.description,
    type: 'package',
    metrics: {
      ...(raw.publishedAt ? { lastUpdated: raw.publishedAt } : {}),
    },
  }),
};

export function normalize(raw: RawResult): Wheel {
  const fn = normalizers[raw.source];
  // default 兜底:理论上 Record<WheelSource, Normalizer> 已在编译期保证所有 source 都注册,
  // 此处运行时检查防御 raw.source 为未知值(如数据损坏或新增未注册 source)的情况。
  if (!fn) {
    throw new Error(`unknown source: ${raw.source}`);
  }
  return fn(raw);
}
