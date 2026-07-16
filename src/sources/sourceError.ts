// src/sources/sourceError.ts
// 统一 adapter catch 块的错误转换逻辑(P1-4)。
//
// 之前 11 个 adapter 各自重复 3 行结构:
//   if (err instanceof HttpError && err.status === 403/429) throw new RateLimitError(...);
//   if (err instanceof HttpError) throw new SourceError(...);
//   throw new SourceError(..., (err as Error).message);
// 且 rate-limit 判定不一致(github/gitee/githubCode 用 403,gitlab 用 429)。
//
// 现在统一到 toSourceError() 一处,默认 [403, 429] 都视为 rate limit。
// 同时区分 404 → NOT_FOUND、401/403(无 token 时)→ UNAUTHORIZED(P1-12)。
//
// toSourceError 已下沉到 util/sourceError.ts(消除 enrich/ 反向依赖)。
// 此文件 re-export 保持向后兼容:所有 `import { toSourceError } from './sourceError.js'`
// 的 sources 适配器及 tests/sources/sourceError.test.ts 无需改动。
export { toSourceError } from '../util/sourceError.js';
export type { ToSourceErrorOpts } from '../util/sourceError.js';
