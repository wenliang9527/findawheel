// src/cache/cache.ts
// 本地缓存层 + in-flight 请求去重。
// 缓存 Wheel[] 最终结果到磁盘,跨会话复用;去重同一进程内同 key 的并发请求。
import type { Wheel } from '../normalize/types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { logError } from '../util/logger.js';
import { sha1Short } from '../util/hash.js';

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

/**
 * 缓存条目外层 schema(P0-1:反序列化校验)。
 * 仅校验外层结构(writtenAt 必须是 number,wheels 字段必须存在),
 * T 内部结构由调用方保证(泛型无法在 schema 里校验)。
 * 损坏文件 safeParse 失败 → 删除文件 + 返回 undefined(视为缓存未命中)。
 */
const CacheEntrySchema = z.object({
  writtenAt: z.number(),
  wheels: z.unknown(),
});

/** 计算 cache key:sha1(query + intent + ecosystem + limit) */
export function cacheKey(
  query: string, intent: string, ecosystem: string | undefined, limit: number,
): string {
  const raw = `${query}|${intent}|${ecosystem ?? ''}|${limit}`;
  return sha1Short(raw);
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
    } catch (err) {
      logError('cache read failed', err);
      return undefined;
    }
    // P0-1:用 zod schema 校验外层结构,损坏文件视为未命中
    let parsed: ReturnType<typeof CacheEntrySchema.safeParse>;
    try {
      parsed = CacheEntrySchema.safeParse(JSON.parse(raw));
    } catch (err) {
      logError('cache parse failed', err);
      try { await fs.promises.unlink(file); } catch { /* ignore */ }
      return undefined;
    }
    if (!parsed.success) {
      logError('cache parse failed', parsed.error);
      // 异常 JSON 或字段缺失,删除损坏文件避免下次再读
      try { await fs.promises.unlink(file); } catch { /* ignore */ }
      return undefined;
    }
    const entry = parsed.data as CacheEntry<T>;
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
    } catch (err) {
      logError('cache write failed', err);
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
