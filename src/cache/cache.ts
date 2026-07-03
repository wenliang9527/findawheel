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

export interface CacheEntry {
  /** 写入时间戳(ms) */
  writtenAt: number;
  /** 缓存的最终排序结果 */
  wheels: Wheel[];
}

/** 计算 cache key:sha1(query + intent + ecosystem + limit) */
export function cacheKey(
  query: string, intent: string, ecosystem: string | undefined, limit: number,
): string {
  const raw = `${query}|${intent}|${ecosystem ?? ''}|${limit}`;
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 24);
}

export interface Cache {
  get(key: string): Promise<Wheel[] | undefined>;
  set(key: string, wheels: Wheel[]): Promise<void>;
  /** 同 key 并发只执行一次 fn,其他复用结果 */
  dedupe<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

export function createCache(opts: CacheOpts): Cache {
  const inFlight = new Map<string, Promise<unknown>>();

  async function get(key: string): Promise<Wheel[] | undefined> {
    if (!opts.enabled) return undefined;
    const file = path.join(opts.dir, `${key}.json`);
    let raw: string;
    try {
      raw = await fs.promises.readFile(file, 'utf8');
    } catch {
      return undefined;
    }
    let entry: CacheEntry;
    try {
      entry = JSON.parse(raw) as CacheEntry;
    } catch {
      return undefined;
    }
    // TTL 过期检查
    if (Date.now() - entry.writtenAt > opts.ttlMs) return undefined;
    return entry.wheels;
  }

  async function set(key: string, wheels: Wheel[]): Promise<void> {
    if (!opts.enabled) return;
    const file = path.join(opts.dir, `${key}.json`);
    const entry: CacheEntry = { writtenAt: Date.now(), wheels };
    try {
      await fs.promises.mkdir(opts.dir, { recursive: true });
      await fs.promises.writeFile(file, JSON.stringify(entry), 'utf8');
    } catch {
      // 缓存写入失败不阻断主流程
    }
  }

  async function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // 已有 in-flight 请求则复用
    const existing = inFlight.get(key);
    if (existing) return existing as Promise<T>;
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
