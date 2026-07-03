// src/util/http.ts
export class HttpError extends Error {
  constructor(public status: number, public url: string, body: string) {
    super(`HTTP ${status} from ${url}: ${body.slice(0, 200)}`);
    this.name = 'HttpError';
  }
}

export interface HttpGetOptions {
  timeoutMs: number;
  token?: string;
  userAgent?: string;
  extraHeaders?: Record<string, string>;
}

export async function httpGet<T>(url: string, opts: HttpGetOptions): Promise<T> {
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
      throw new HttpError(res.status, url, body);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
