// src/util/http.ts
import { withRetry, RetryableError, type RetryOpts } from './retry.js';

/**
 * 应用版本号(与 package.json version 保持一致)。
 * 集中到一处常量避免散落多处硬编码,版本升级时只需改这一处 + package.json。
 * 不引入构建时注入(保持构建简单),版本号变化时手动同步。
 */
const APP_VERSION = '0.1.0';

/** HTTP user-agent 头默认值,标识 findawheel 客户端 */
const USER_AGENT = `findawheel/${APP_VERSION}`;

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    body: string,
    /** 响应头(小写键),供下游读取 Retry-After / X-RateLimit-Reset 等限流信息 */
    public headers?: Record<string, string>,
  ) {
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

export interface HttpPostOptions {
  timeoutMs: number;
  /** 请求头(如 Content-Type / x-api-key 等) */
  headers?: Record<string, string>;
  /** 请求体(已 JSON.stringify 的字符串) */
  body: string;
  /** 重试配置,不传则不重试 */
  retry?: RetryOpts;
  /** 返回 text 而非 JSON(用于特殊响应) */
  text?: boolean;
}

/**
 * 共用的 fetch 执行器(GET/POST 复用)。
 * 统一超时控制、错误包装(5xx/网络错误 → RetryableError,4xx → HttpError)。
 */
async function doFetch<T>(
  url: string,
  method: 'GET' | 'POST',
  opts: {
    timeoutMs: number;
    headers: Record<string, string>;
    body?: string;
    text?: boolean;
  },
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const fetchOpts: RequestInit = {
      method,
      headers: opts.headers,
      signal: controller.signal,
    };
    if (method === 'POST' && opts.body !== undefined) {
      fetchOpts.body = opts.body;
    }
    const res = await fetch(url, fetchOpts);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new HttpError(res.status, url, body, Object.fromEntries(res.headers.entries()));
      if (err.retryable) throw new RetryableError(err.message, { cause: err });
      throw err;
    }
    // text 模式:返回原始文本(用于 HTML 解析);否则解析 JSON
    if (opts.text) return (await res.text()) as T;
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof RetryableError) throw err;
    if (err instanceof HttpError) throw err;
    throw new RetryableError((err as Error).message, { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

export async function httpGet<T>(url: string, opts: HttpGetOptions): Promise<T> {
  const headers: Record<string, string> = {
    'accept': 'application/json',
    'user-agent': opts.userAgent ?? USER_AGENT,
    ...opts.extraHeaders,
  };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;

  const doFetchFn = () => doFetch<T>(url, 'GET', {
    timeoutMs: opts.timeoutMs,
    headers,
    text: opts.text,
  });

  // 无重试配置时直接执行(保持原行为)
  if (!opts.retry) return doFetchFn();
  return withRetry(doFetchFn, opts.retry);
}

/**
 * POST 请求,与 httpGet 共享超时/重试/错误处理逻辑。
 * 用于 Exa/Tavily 等 POST API,统一走 http 层获得 5xx 重试能力。
 */
export async function httpPost<T>(url: string, opts: HttpPostOptions): Promise<T> {
  const headers: Record<string, string> = {
    'accept': 'application/json',
    'user-agent': USER_AGENT,
    ...opts.headers,
  };

  const doFetchFn = () => doFetch<T>(url, 'POST', {
    timeoutMs: opts.timeoutMs,
    headers,
    body: opts.body,
    text: opts.text,
  });

  if (!opts.retry) return doFetchFn();
  return withRetry(doFetchFn, opts.retry);
}
