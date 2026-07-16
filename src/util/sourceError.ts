// src/util/sourceError.ts
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
// 下沉到 util 层:enrich/(readmeFetcher/releaseFetcher)原本反向依赖 sources/sourceError,
// 现在直接从 util/sourceError 引入,消除反向依赖。sources/sourceError.ts 改为 re-export
// 保持所有现有 import 路径('../sources/sourceError.js' / './sourceError.js')向后兼容。
import { HttpError } from './http.js';
import { SourceError, RateLimitError, ErrorCode } from '../errors.js';

/** 默认限流恢复时间:1 小时后(无 header 时的兜底) */
const DEFAULT_RATE_LIMIT_RESET_MS = 3600 * 1000;

/**
 * 从响应头解析限流恢复时间(resetAt,毫秒时间戳)。
 * 优先级:X-RateLimit-Reset(GitHub 标准,绝对 Unix 秒)> Retry-After(相对秒)> 默认 1 小时。
 * header 名大小写无关(Headers 对象会小写化,但防御性处理)。
 */
function parseResetAtMs(headers?: Record<string, string>): number {
  if (headers) {
    try {
      // 大小写无关查 header 值
      const get = (name: string): string | undefined => {
        const lower = name.toLowerCase();
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === lower) return headers[key];
        }
        return undefined;
      };
      // 1. X-RateLimit-Reset:绝对 Unix 时间戳(秒)
      const xReset = get('x-ratelimit-reset');
      if (xReset !== undefined) {
        const ts = Number(xReset);
        if (Number.isFinite(ts) && ts > 0) {
          return ts * 1000;
        }
      }
      // 2. Retry-After:相对秒数
      const retryAfter = get('retry-after');
      if (retryAfter !== undefined) {
        const secs = Number(retryAfter);
        if (Number.isFinite(secs) && secs > 0) {
          return Date.now() + secs * 1000;
        }
      }
    } catch {
      // 解析异常回退默认值
    }
  }
  return Date.now() + DEFAULT_RATE_LIMIT_RESET_MS;
}

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
      return new SourceError(source, `not found: ${err.message}`, ErrorCode.NOT_FOUND, { cause: err });
    }
    // 401 → UNAUTHORIZED(token 失效或未提供)
    if (unauthorizedStatus.includes(err.status)) {
      return new SourceError(source, `unauthorized: ${err.message}`, ErrorCode.UNAUTHORIZED, { cause: err });
    }
    // 403/429 → RATE_LIMIT
    if (rateLimitStatus.includes(err.status)) {
      // 从响应头读取真实恢复时间;无 header 时回退默认 1 小时
      const resetAt = new Date(parseResetAtMs(err.headers));
      return new RateLimitError(source, resetAt, { cause: err });
    }
    // 其他 HTTP 错误 → SOURCE_FAILURE
    return new SourceError(source, `HTTP ${err.status}: ${err.message}`, ErrorCode.SOURCE_FAILURE, { cause: err });
  }
  // 非 HTTP 错误(网络错误、解析错误等)
  // 注:err 可能是 null/undefined/字符串,用 instanceof Error 安全判断
  const errMsg = err instanceof Error ? err.message : String(err ?? '');
  return new SourceError(source, errMsg, ErrorCode.SOURCE_FAILURE, { cause: err });
}
