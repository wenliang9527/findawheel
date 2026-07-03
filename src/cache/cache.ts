// src/cache/cache.ts
// 本地缓存层 + in-flight 请求去重。
// 缓存 Wheel[] 最终结果到磁盘,跨会话复用;去重同一进程内同 key 的并发请求。
import type { Wheel } from '../normalize/types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export interface CacheOpts {
  /** 缓存目录(磁盘持久化) */
  dir: string;
  /** TTL 毫秒 */
  ttlMs: number;
  /** 是否启用 */
  enabled: boolean;
}

export interface CacheEntry<T = Wheel[]> {
  /** 写入时间戳(ms) */
  writtenAt: number;
  /** 缓存值(字段名保留 wheels 以向后兼容,实际可为任意类型) */
  wheels: T;
}

/** 计算 cache key:sha1(query + intent + ecosystem + limit) */
export function cacheKey(
  query: string, intent: string, ecosystem: string | undefined, limit: number,
): string {
  const raw = `${query}|${intent}|${ecosystem ?? ''}|${limit}`;
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 24);
}

export interface Cache<T = Wheel[]> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T): Promise<void>;
  /** 同 key 并发只执行一次 fn,其他复用结果 */
  dedupe<U>(key: string, fn: () => Promise<U>): Promise<U>;
}

export function createCache<T = Wheel[]>(opts: CacheOpts): Cache<T> {
  const inFlight = new Map<string, Promise<unknown>>();

  async function get(key: string): Promise<T | undefined> {
    if (!opts.enabled) return undefined;
    const file = path.join(opts.dir, `${key}.json`);
    let raw: string;
    try {
      raw = await fs.promises.readFile(file, 'utf8');
    } catch {
      return undefined;
    }
    let entry: CacheEntry<T>;
    try {
      entry = JSON.parse(raw) as CacheEntry<T>;
    } catch {
      return undefined;
    }
    // TTL 过期检查
    if (Date.now() - entry.writtenAt > opts.ttlMs) return undefined;
    return entry.wheels;
  }

  async function set(key: string, value: T): Promise<void> {
    if (!opts.enabled) return;
    const file = path.join(opts.dir, `${key}.json`);
    const entry: CacheEntry<T> = { writtenAt: Date.now(), wheels: value };
    try {
      await fs.promises.mkdir(opts.dir, { recursive: true });
      await fs.promises.writeFile(file, JSON.stringify(entry), 'utf8');
    } catch {
      // 缓存写入失败不阻断主流程
    }
  }

  async function dedupe<U>(key: string, fn: () => Promise<U>): Promise<U> {
    // 已有 in-flight 请求则复用
    const existing = inFlight.get(key);
    if (existing) return existing as Promise<U>;
    const p = fn();
    inFlight.set(key, p);
    try {
      return await p;
    } finally {
      inFlight.delete(key);
    }
  }

  return { get, set, dedupe };
}
