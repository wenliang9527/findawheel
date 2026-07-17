// src/cache/cache.ts
// 本地缓存层 + in-flight 请求去重。
// 缓存 Wheel[] 最终结果到磁盘,跨会话复用;去重同一进程内同 key 的并发请求。
import type { Wheel } from '../normalize/types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { logError, logWarn } from '../util/logger.js';
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
      try { await fs.promises.unlink(file); } catch (err) { logWarn('cache unlink failed: ' + file, err); }
      return undefined;
    }
    if (!parsed.success) {
      logError('cache parse failed', parsed.error);
      // 异常 JSON 或字段缺失,删除损坏文件避免下次再读
      try { await fs.promises.unlink(file); } catch (err) { logWarn('cache unlink failed: ' + file, err); }
      return undefined;
    }
    const entry = parsed.data as CacheEntry<T>;
    // TTL 过期检查:过期则删除文件(被动清理,避免缓存目录无限增长)
    if (Date.now() - entry.writtenAt > opts.ttlMs) {
      try { await fs.promises.unlink(file); } catch (err) { logWarn('cache unlink failed: ' + file, err); }
      return undefined;
    }
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
    // 1% 概率触发清理(写时清理,避免无界增长)
    if (Math.random() < 0.01) {
      cleanupExpired(opts.dir, opts.ttlMs).catch(() => {});  // 不 await,不阻塞写入
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

/**
 * 主动清理缓存目录中的过期文件(修复4)。
 *
 * 仅有被动 TTL 清理(get 时发现过期才 unlink)会导致从未被读取的过期文件永远残留,
 * 磁盘空间无界增长。本函数遍历 cacheDir 下所有 .json 文件,parse 后检查
 * writtenAt + ttlMs 是否过期,过期则 unlink。
 *
 * 并发控制:批量处理(每批 100 个),避免同时 unlink 上万文件触发 fd/IO 压力。
 * 只清理过期文件;损坏文件(schema 校验失败)直接删除,行为与 get() 一致。
 *
 * @returns 实际清理的文件数
 */
export async function cleanupExpired(cacheDir: string, ttlMs: number): Promise<number> {
  let files: string[];
  try {
    files = await fs.promises.readdir(cacheDir);
  } catch (err) {
    logError('cache cleanup readdir failed', err);
    return 0;
  }
  const jsonFiles = files.filter(f => f.endsWith('.json'));
  let cleaned = 0;
  const BATCH = 100;
  for (let i = 0; i < jsonFiles.length; i += BATCH) {
    const batch = jsonFiles.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map(async (f): Promise<boolean> => {
        const file = path.join(cacheDir, f);
        let raw: string;
        try {
          raw = await fs.promises.readFile(file, 'utf8');
        } catch (err) {
          // 读失败跳过(可能权限问题,不删)
          return false;
        }
        // P2-5:用 zod schema 校验外层结构(与 get 函数行为一致)
        let parsed: ReturnType<typeof CacheEntrySchema.safeParse>;
        try {
          parsed = CacheEntrySchema.safeParse(JSON.parse(raw));
        } catch (err) {
          // 无效 JSON,删除损坏文件(与 get 函数行为一致)
          try { await fs.promises.unlink(file); } catch { /* ignore */ }
          return false;
        }
        if (!parsed.success) {
          // schema 校验失败,删除损坏文件(与 get 函数行为一致)
          try { await fs.promises.unlink(file); } catch { /* ignore */ }
          return false;
        }
        const entry = parsed.data;
        // 只清理过期文件(writtenAt 已由 schema 保证为 number)
        if (Date.now() - entry.writtenAt > ttlMs) {
          try {
            await fs.promises.unlink(file);
            return true;
          } catch (err) {
            logWarn('cache unlink failed: ' + file, err);
            return false;
          }
        }
        return false;
      }),
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) cleaned += 1;
    }
  }
  return cleaned;
}
