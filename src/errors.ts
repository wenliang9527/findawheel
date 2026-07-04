// src/errors.ts
// 错误码常量(字符串枚举,便于日志聚合/分类)。
// 所有 SourceError 子类共享 code 字段,默认 'SOURCE_FAILURE'。
export const ErrorCode = {
  SOURCE_FAILURE: 'SOURCE_FAILURE',  // 源不可用(HTTP 5xx / 网络错误 / 解析失败)
  RATE_LIMIT: 'RATE_LIMIT',          // 限流(GitHub/GitLab 403/429)
  NOT_FOUND: 'NOT_FOUND',            // 资源不存在(404)
  UNAUTHORIZED: 'UNAUTHORIZED',      // 鉴权失败(401/403 非 rate limit)
} as const;
export type ErrorCode = typeof ErrorCode[keyof typeof ErrorCode];

export class SourceError extends Error {
  readonly code: ErrorCode;
  constructor(public source: string, message: string, code: ErrorCode = ErrorCode.SOURCE_FAILURE) {
    super(`[${source}] ${message}`);
    this.name = 'SourceError';
    this.code = code;
  }
}

export class RateLimitError extends SourceError {
  constructor(source: string, public resetAt: Date) {
    super(source, `rate limited, resets at ${resetAt.toISOString()}`, ErrorCode.RATE_LIMIT);
    this.name = 'RateLimitError';
  }
}
