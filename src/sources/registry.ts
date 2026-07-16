// src/sources/registry.ts
// 数据源适配器注册表(单一维护点)。
//
// 新增数据源只需在此文件加一行 import + 一行 new,
// ALL_SOURCES 会自动从 adapter.name 派生,
// 消除 sourceRouter.ts 手写字符串 与 server.ts 实例化的双重同步。

import type { SourceAdapter } from './sourceAdapter.js';
import { GitHubSourceAdapter } from './githubSourceAdapter.js';
import { GiteeSourceAdapter } from './giteeSourceAdapter.js';
import { RegistrySourceAdapter } from './registrySourceAdapter.js';
import { WebSourceAdapter } from './webSourceAdapter.js';
import { GitlabSourceAdapter } from './gitlabSourceAdapter.js';
import { PypiSourceAdapter } from './pypiSourceAdapter.js';
import { LibrariesIoSourceAdapter } from './librariesIoSourceAdapter.js';
import { GitHubCodeSourceAdapter } from './githubCodeSourceAdapter.js';
import { VscodeMarketplaceSourceAdapter } from './vscodeMarketplaceSourceAdapter.js';
import { PapersWithCodeSourceAdapter } from './papersWithCodeSourceAdapter.js';
import { HuggingfaceSourceAdapter } from './huggingfaceSourceAdapter.js';
import { MavenSourceAdapter } from './mavenSourceAdapter.js';
import { RubyGemsSourceAdapter } from './rubygemsSourceAdapter.js';
import { GoModuleSourceAdapter } from './goModuleSourceAdapter.js';

/** 已实例化的全部数据源适配器(server.ts 直接引用) */
export const ADAPTERS: SourceAdapter[] = [
  new GitHubSourceAdapter(),
  new GiteeSourceAdapter(),
  new RegistrySourceAdapter(),
  new WebSourceAdapter(),
  new GitlabSourceAdapter(),
  new PypiSourceAdapter(),
  new LibrariesIoSourceAdapter(),
  new GitHubCodeSourceAdapter(),
  new VscodeMarketplaceSourceAdapter(),
  new PapersWithCodeSourceAdapter(),
  new HuggingfaceSourceAdapter(),
  new MavenSourceAdapter(),
  new RubyGemsSourceAdapter(),
  new GoModuleSourceAdapter(),
];

/**
 * 所有数据源名(由 adapter.name 自动派生,不再手写字符串)。
 * 与 server.ts 中注册的 adapter 一一对应(同一数据源)。
 */
export const ALL_SOURCES = Object.freeze(
  ADAPTERS.map(a => a.name),
) as readonly string[];
