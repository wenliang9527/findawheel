// src/util/http.ts
import { withRetry, RetryableError, type RetryOpts } from './retry.js';

export class HttpError extends Error {
  constructor(public status: number, public url: string, body: string) {
    super(`HTTP ${status} from ${url}: ${body.slice(0, 200)}`);
    this.name = 'HttpError';
  }
  /** 5xx 可重试,4xx 不可重试 */
  get retryable(): boolean {
    return this.status >= 500;
  }
}

export interface HttpGetOptions {
  timeoutMs: number;
  token?: string;
  userAgent?: string;
  extraHeaders?: Record<string, string>;
  /** 重试配置,不传则不重试 */
  retry?: RetryOpts;
  /** 返回 text 而非 JSON(用于 HTML 解析场景,如 PyPI) */
  text?: boolean;
}

export async function httpGet<T>(url: string, opts: HttpGetOptions): Promise<T> {
  const doFetch = async (): Promise<T> => {
    const headers: Record<string, string> = {
      'accept': 'application/json',
      'user-agent': opts.userAgent ?? 'findawheel/0.1',
      ...opts.extraHeaders,
    };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const err = new HttpError(res.status, url, body);
        // 5xx 包装成 RetryableError 让 withRetry 重试
        if (err.retryable) throw new RetryableError(err.message);
        throw err;
      }
      // text 模式:返回原始文本(用于 HTML 解析);否则解析 JSON
      if (opts.text) return (await res.text()) as T;
      return (await res.json()) as T;
    } catch (err) {
      // 网络错误/abort 也包装成可重试
      if (err instanceof RetryableError) throw err;
      if (err instanceof HttpError) throw err;
      // TypeError(fetch failed) / AbortError
      throw new RetryableError((err as Error).message);
    } finally {
      clearTimeout(timer);
    }
  };

  // 无重试配置时直接执行(保持原行为)
  if (!opts.retry) return doFetch();
  return withRetry(doFetch, opts.retry);
}
