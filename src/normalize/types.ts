// src/normalize/types.ts
export type WheelSource = 'github' | 'npm' | 'pypi' | 'crates' | 'web';
export type WheelType = 'project' | 'package' | 'api' | 'cli' | 'sdk';
export type Activity = 'high' | 'medium' | 'low';

/** 推荐等级:从高到低 */
export type Recommendation =
  | 'highly_recommended' // 强烈推荐:高匹配 + 高 star + 活跃
  | 'recommended'        // 推荐:中等匹配或匹配但 star 一般
  | 'optional'           // 可选:低匹配或数据不足
  | 'not_recommended';   // 不推荐:虽未被过滤但匹配度很低

/** 查询相关的匹配信息,搜索结果里填充 */
export interface WheelMatch {
  /** 综合匹配分 0~1,结合相关度+热度+活跃度 */
  score: number;
  /** 推荐等级 */
  recommendation: Recommendation;
  /** 推荐理由(中文简述),给 AI 总结时引用 */
  reason: string;
  /** 命中的 query 关键词列表 */
  matchedKeywords: string[];
}

export interface WheelMetrics {
  stars?: number;
  lastUpdated?: string; // ISO date
  license?: string;
  archived?: boolean;
  downloads?: number;
  activity?: Activity;
}

export interface Wheel {
  name: string;
  source: WheelSource;
  url: string;
  description: string;
  type: WheelType;
  metrics: WheelMetrics;
  /** 查询相关的匹配信息(可选,只在搜索结果里填充) */
  match?: WheelMatch;
}

export type Intent = 'feature' | 'project';

export interface FindWheelInput {
  query: string;
  intent?: 'feature' | 'project' | 'auto';
  ecosystem?: string;
  limit?: number;
}

export interface FindWheelOutput {
  query: string;
  intent: Intent;
  total: number;
  wheels: Wheel[];
  degradedSources?: string[];
}

// Discriminated union of raw results per source
export interface GitHubRawResult {
  source: 'github';
  name: string;
  url: string;
  description: string;
  stars: number;
  language: string | null;
  license: string | null;
  archived: boolean;
  pushedAt: string;
  topics: string[];
}

export interface NpmRawResult {
  source: 'npm';
  name: string;
  url: string;
  description: string;
  version: string;
  keywords: string[];
  date: string; // last publish
  downloads?: number; // 周下载量(来自 npm downloads API)
  stars?: number; // GitHub stars(如果包关联了 GitHub 仓库)
  githubUrl?: string; // 关联的 GitHub 仓库地址
}

export interface CratesRawResult {
  source: 'crates';
  name: string;
  url: string;
  description: string;
  version: string;
  downloads: number;
  recentDownloads: number;
  updatedAt: string;
  license: string | null;
}

export type RawResult = GitHubRawResult | NpmRawResult | CratesRawResult;
