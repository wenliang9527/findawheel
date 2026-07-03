// src/index.ts
import { runServer } from './server.js';

runServer().catch(err => {
  console.error('[findawheel] fatal:', err);
  process.exit(1);
});
