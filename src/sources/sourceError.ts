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
import { HttpError } from '../util/http.js';
import { SourceError, RateLimitError, ErrorCode } from '../errors.js';

export interface ToSourceErrorOpts {
  /**
   * 视为 rate limit 的 HTTP 状态码(默认 [403, 429])。
   * 不同源行为不一:GitHub/Gitee 用 403,GitLab 用 429,统一覆盖更稳。
   */
  rateLimitStatus?: number[];
  /**
   * 视为未授权的 HTTP 状态码(默认 [401])。
   * 403 在多数源里是 rate limit,所以不放这里。
   */
  unauthorizedStatus?: number[];
}

/**
 * 把 adapter search() 抛出的任意错误转换为 SourceError/RateLimitError。
 *
 * @param source 源名称('github'/'npm'/...)
 * @param err 原始错误
 * @param opts 状态码分类配置
 */
export function toSourceError(
  source: string,
  err: unknown,
  opts: ToSourceErrorOpts = {},
): Error {
  const rateLimitStatus = opts.rateLimitStatus ?? [403, 429];
  const unauthorizedStatus = opts.unauthorizedStatus ?? [401];

  if (err instanceof HttpError) {
    // 404 → NOT_FOUND(资源不存在,AI 不应重试)
    if (err.status === 404) {
      return new SourceError(source, `not found: ${err.message}`, ErrorCode.NOT_FOUND);
    }
    // 401 → UNAUTHORIZED(token 失效或未提供)
    if (unauthorizedStatus.includes(err.status)) {
      return new SourceError(source, `unauthorized: ${err.message}`, ErrorCode.UNAUTHORIZED);
    }
    // 403/429 → RATE_LIMIT
    if (rateLimitStatus.includes(err.status)) {
      // resetAt 未知时用 1 小时后(让调用方至少知道大概恢复时间)
      return new RateLimitError(source, new Date(Date.now() + 3600 * 1000));
    }
    // 其他 HTTP 错误 → SOURCE_FAILURE
    return new SourceError(source, `HTTP ${err.status}: ${err.message}`);
  }
  // 非 HTTP 错误(网络错误、解析错误等)
  return new SourceError(source, (err as Error).message ?? String(err));
}
