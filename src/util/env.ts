import * as path from 'node:path';
import * as os from 'node:os';

export interface EnvConfig {
  githubToken?: string;
  /** Exa API key(Web 搜索主源,神经网络搜索),可选 */
  exaApiKey?: string;
  /** Tavily API key(Web 搜索兜底源),可选 */
  tavilyApiKey?: string;
  /** GitLab token(可选,提升限流) */
  gitlabToken?: string;
  /** Libraries.io API key(可选,启用多包管理器搜索) */
  librariesIoApiKey?: string;
  /** 用户项目 license(可选,用于 license 兼容性比对,如 MIT/Apache-2.0/GPL-3.0) */
  userLicense?: string;
  limit: number;
  timeoutMs: number;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  /** 缓存是否启用,默认 true */
  cacheEnabled: boolean;
  /** 缓存 TTL 毫秒,默认 1 小时 */
  cacheTtlMs: number;
  /** 缓存目录,默认 ~/.findawheel/cache */
  cacheDir: string;
  /** 反馈存储目录,默认 ~/.findawheel/feedback (持久化用户反馈, 不参与 TTL) */
  feedbackDir: string;
  /** 知识库搜索是否启用,默认 false (需用户显式开启) */
  kbEnabled: boolean;
  /** 知识库根目录列表(支持多个,逗号分隔),如 Obsidian vault / 笔记目录 */
  kbRoots: string[];
  /** 知识库单文件大小上限(KB),默认 100,避免读超大文件 */
  kbMaxFileKb: number;
  /** 知识库搜索结果是否启用磁盘缓存,默认 false(每次扫描保证最新)。设为 true 走 findawheel 主缓存 */
  kbCacheEnabled: boolean;
}

function parseInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1' || value === 'yes';
}

export function readEnv(): EnvConfig {
  const level = process.env.FINDAWHEEL_LOG_LEVEL;
  const validLevels = ['error', 'warn', 'info', 'debug'] as const;
  const defaultCacheDir = path.join(os.homedir(), '.findawheel', 'cache');
  const defaultFeedbackDir = path.join(os.homedir(), '.findawheel', 'feedback');
  // 知识库根目录:逗号分隔,支持 Windows 反斜杠路径
  const kbRootsRaw = process.env.FINDAWHEEL_KB_ROOT || '';
  const kbRoots = kbRootsRaw
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  return {
    githubToken: process.env.GITHUB_TOKEN || undefined,
    exaApiKey: process.env.EXA_API_KEY || undefined,
    tavilyApiKey: process.env.TAVILY_API_KEY || undefined,
    gitlabToken: process.env.GITLAB_TOKEN || undefined,
    librariesIoApiKey: process.env.LIBRARIES_IO_API_KEY || undefined,
    userLicense: process.env.FINDAWHEEL_USER_LICENSE || undefined,
    limit: parseInt(process.env.FINDAWHEEL_LIMIT, 20),
    timeoutMs: parseInt(process.env.FINDAWHEEL_TIMEOUT_MS, 8000),
    logLevel: level && (validLevels as readonly string[]).includes(level)
      ? (level as EnvConfig['logLevel'])
      : 'info',
    cacheEnabled: parseBool(process.env.FINDAWHEEL_CACHE_ENABLED, true),
    cacheTtlMs: parseInt(process.env.FINDAWHEEL_CACHE_TTL_MS, 3600000),
    cacheDir: process.env.FINDAWHEEL_CACHE_DIR || defaultCacheDir,
    feedbackDir: process.env.FINDAWHEEL_FEEDBACK_DIR || defaultFeedbackDir,
    kbEnabled: parseBool(process.env.FINDAWHEEL_KB_ENABLED, false),
    kbRoots,
    kbMaxFileKb: parseInt(process.env.FINDAWHEEL_KB_MAX_FILE_KB, 100),
    kbCacheEnabled: parseBool(process.env.FINDAWHEEL_KB_CACHE_ENABLED, false),
  };
}
