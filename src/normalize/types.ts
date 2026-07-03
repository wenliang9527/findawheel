// src/normalize/types.ts
export type WheelSource = 'github' | 'npm' | 'pypi' | 'crates' | 'web';
export type WheelType = 'project' | 'package' | 'api' | 'cli' | 'sdk';
export type Activity = 'high' | 'medium' | 'low';

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
