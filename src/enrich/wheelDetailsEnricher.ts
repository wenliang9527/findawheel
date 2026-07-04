// src/enrich/wheelDetailsEnricher.ts
import type { Wheel } from '../normalize/types.js';
import { fetchReadme } from './readmeFetcher.js';
import { fetchLatestRelease, type LatestRelease } from './releaseFetcher.js';
import { extractCodeSnippets, type CodeSnippet } from './codeSnippetExtractor.js';
import { checkLicenseCompatibility, type LicenseCheck } from './licenseCompatibility.js';
import { isValidOwnerRepo } from '../util/nameValidator.js';

export interface WheelDetails {
  /** 所属 wheel 标识（GitHub 源为 owner/repo） */
  name: string;
  source: string;
  url: string;
  /** README 前 N 行摘要（抓取失败时为空字符串） */
  readmeSnippet: string;
  /** 从 README 提取的代码示例（最多 2 个，抓取失败时为空数组） */
  codeExamples: CodeSnippet[];
  /** 最新 release 信息（无 release 时省略） */
  release?: LatestRelease;
  /** license 兼容性检查（userLicense 未配置时省略） */
  licenseCheck?: LicenseCheck;
}

export interface EnrichDetailsOpts {
  timeoutMs: number;
  githubToken?: string;
  /** 用户项目 license（用于兼容性比对，可选） */
  userLicense?: string;
}

/**
 * 判断 wheel 是否可抓取详情（仅 GitHub 源有 README/releases API）。
 * wheel.name 对 GitHub 源是 "owner/repo" 格式。
 */
function extractRepo(wheel: Wheel): string | null {
  if (wheel.source !== 'github') return null;
  if (!isValidOwnerRepo(wheel.name)) return null;
  return wheel.name;
}

/**
 * 为单个 Wheel 抓取详情（README + releases + license 比对）。
 * 仅对 GitHub 源生效,其他源返回 null（无 README API）。
 * 并行抓取 readme + release,任一失败填空不阻断（增强信息缺失不影响主流程）。
 */
export async function enrichDetails(
  wheel: Wheel,
  opts: EnrichDetailsOpts,
): Promise<WheelDetails | null> {
  const repo = extractRepo(wheel);
  if (!repo) return null;

  // 并行抓取 README 和最新 release,任一失败容错（不阻断整个 enrich）
  const [readmeResult, releaseResult] = await Promise.allSettled([
    fetchReadme(repo, { timeoutMs: opts.timeoutMs, githubToken: opts.githubToken }),
    fetchLatestRelease(repo, { timeoutMs: opts.timeoutMs, githubToken: opts.githubToken }),
  ]);

  const readmeSnippet = readmeResult.status === 'fulfilled' ? readmeResult.value : '';
  const release = releaseResult.status === 'fulfilled' ? releaseResult.value : null;
  const codeExamples = readmeSnippet ? extractCodeSnippets(readmeSnippet) : [];

  const details: WheelDetails = {
    name: wheel.name,
    source: wheel.source,
    url: wheel.url,
    readmeSnippet,
    codeExamples,
  };
  if (release) details.release = release;
  if (opts.userLicense) {
    details.licenseCheck = checkLicenseCompatibility(wheel.metrics.license, opts.userLicense);
  }
  return details;
}
