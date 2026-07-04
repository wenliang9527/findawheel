// src/util/logger.ts
// 轻量日志器:基于 env.logLevel 控制输出,默认 error 级别。
// 用于填补空 catch 块,让磁盘满/权限错误/JSON 损坏等可诊断。
//
// 设计:输出到 stderr(MCP stdio 协议下 stdout 被占用)。
// 简单开关式过滤,不引入 pino/winston 等依赖。

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

/** 错误日志:总是输出。用于 catch 块中记录吞掉的错误。 */
export function logError(message: string, err?: unknown): void {
  if (!shouldLog('error')) return;
  const errStr = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? '');
  process.stderr.write(`[findawheel] ERROR: ${message}${errStr ? ` — ${errStr}` : ''}\n`);
}

/** 警告日志:可恢复的异常情况 */
export function logWarn(message: string, err?: unknown): void {
  if (!shouldLog('warn')) return;
  const errStr = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? '');
  process.stderr.write(`[findawheel] WARN: ${message}${errStr ? ` — ${errStr}` : ''}\n`);
}

/** 信息日志:常规运行信息 */
export function logInfo(message: string): void {
  if (!shouldLog('info')) return;
  process.stderr.write(`[findawheel] INFO: ${message}\n`);
}

/** 调试日志:详细诊断信息 */
export function logDebug(message: string): void {
  if (!shouldLog('debug')) return;
  process.stderr.write(`[findawheel] DEBUG: ${message}\n`);
}
