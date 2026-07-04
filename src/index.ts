// src/index.ts
import { runServer } from './server.js';
import { readEnv } from './util/env.js';
import { setLogLevel } from './util/logger.js';

// 初始化日志级别(从 env.logLevel 读取)
setLogLevel(readEnv().logLevel);

runServer().catch(err => {
  console.error('[findawheel] fatal:', err);
  process.exit(1);
});
