// src/index.ts
import { runServer } from './server.js';
import { readEnv } from './util/env.js';
import { setLogLevel } from './util/logger.js';

// 初始化日志级别(从 env.logLevel 读取)
setLogLevel(readEnv().logLevel);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`[findawheel] received ${signal}, shutting down...`);
  // 给进行中的 IO 一个短暂窗口(500ms 超时)
  await new Promise(resolve => setTimeout(resolve, 500));
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

runServer().catch(err => {
  console.error('[findawheel] fatal:', err);
  process.exit(1);
});
