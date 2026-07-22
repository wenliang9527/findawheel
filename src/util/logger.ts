// src/util/logger.ts
// 轻量日志器:基于 env.logLevel 控制输出,默认 error 级别。
// 用于填补空 catch 块,让磁盘满/权限错误/JSON 损坏等可诊断。
//
// 设计:输出到 stderr(MCP stdio 协议下 stdout 被占用)。
// 简单开关式过滤,不引入 pino/winston 等依赖。
//
// M16:支持结构化输出。FINDAWHEEL_LOG_FORMAT=json 时输出 NDJSON(每行一个 JSON 对象,
// 含 ts/level/msg/err 字段,便于生产环境采集与检索);默认 text 格式(带 ISO 时间戳,
// 人读友好)。默认 text 模式下日志级别标签/[findawheel] 前缀/消息内容保持兼容。

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

let currentLevel: LogLevel = 'error';

/** 初始化日志级别(从 env.logLevel 读取) */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] <= LEVEL_PRIORITY[currentLevel];
}

function formatError(err?: unknown): string {
  if (err == null) return '';
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

// M16:日志格式开关。json = NDJSON 结构化(生产采集);text = 带时间戳的可读文本(默认)。
const LOG_FORMAT = (process.env.FINDAWHEEL_LOG_FORMAT ?? 'text').toLowerCase();

function writeLog(level: LogLevel, message: string, err?: unknown): void {
  const ts = new Date().toISOString();
  if (LOG_FORMAT === 'json') {
    const entry: Record<string, string> = { ts, level, msg: message };
    const errStr = formatError(err);
    if (errStr) entry.err = errStr;
    process.stderr.write(JSON.stringify(entry) + '\n');
    return;
  }
  const errStr = formatError(err);
  process.stderr.write(
    `${ts} [findawheel] ${level.toUpperCase()}: ${message}${errStr ? ` — ${errStr}` : ''}\n`,
  );
}

export function logError(message: string, err?: unknown): void {
  if (!shouldLog('error')) return;
  writeLog('error', message, err);
}

export function logWarn(message: string, err?: unknown): void {
  if (!shouldLog('warn')) return;
  writeLog('warn', message, err);
}

/** 信息日志:常规运行信息 */
export function logInfo(message: string): void {
  if (!shouldLog('info')) return;
  writeLog('info', message);
}

/** 调试日志:详细诊断信息 */
export function logDebug(message: string): void {
  if (!shouldLog('debug')) return;
  writeLog('debug', message);
}
