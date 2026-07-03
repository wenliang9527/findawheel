export interface EnvConfig {
  githubToken?: string;
  /** Exa API key(Web 搜索主源,神经网络搜索),可选 */
  exaApiKey?: string;
  /** Tavily API key(Web 搜索兜底源),可选 */
  tavilyApiKey?: string;
  limit: number;
  timeoutMs: number;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
}

function parseInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function readEnv(): EnvConfig {
  const level = process.env.FINDAWHEEL_LOG_LEVEL;
  const validLevels = ['error', 'warn', 'info', 'debug'] as const;
  return {
    githubToken: process.env.GITHUB_TOKEN || undefined,
    exaApiKey: process.env.EXA_API_KEY || undefined,
    tavilyApiKey: process.env.TAVILY_API_KEY || undefined,
    limit: parseInt(process.env.FINDAWHEEL_LIMIT, 20),
    timeoutMs: parseInt(process.env.FINDAWHEEL_TIMEOUT_MS, 8000),
    logLevel: level && (validLevels as readonly string[]).includes(level)
      ? (level as EnvConfig['logLevel'])
      : 'info',
  };
}
