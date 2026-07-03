// src/util/retry.ts
// 重试包装器:仅对 RetryableError 重试(网络错误 + 5xx),4xx 直接抛。
// 指数退避:baseMs * 2^attempt

/** 可重试错误标记(网络错误、5xx 等) */
export class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

export interface RetryOpts {
  /** 最大重试次数(不含首次) */
  retries: number;
  /** 基础退避毫秒,每次 ×2 */
  baseMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      // 仅 RetryableError 才重试
      if (!(err instanceof RetryableError)) throw err;
      // 最后一次不再等待
      if (attempt === opts.retries) break;
      const delay = opts.baseMs * Math.pow(2, attempt);
      await sleep(delay);
    }
  }
  throw lastError;
}
