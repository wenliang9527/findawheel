// src/feedback/feedbackStore.ts
// 本地反馈存储层: 持久化用户对 wheel 的反馈(like/hide/click),用于后续排序加权。
// 存储位置: ~/.findawheel/feedback/<feedback-key>.json
// 与 cache/ 分离: 反馈是持久用户数据, 不参与 TTL 过期。
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { logError, logInfo } from '../util/logger.js';
import { sha1Short } from '../util/hash.js';

/** 反馈动作类型 */
export type FeedbackAction = 'like' | 'hide' | 'click';

/**
 * 反馈动作常量列表(P1-11:供 recordFeedbackTool 复用,避免双重维护)。
 */
export const FEEDBACK_ACTIONS: readonly FeedbackAction[] = ['like', 'hide', 'click'];

/**
 * getAllFeedback 批量读取反馈文件的并发上限(P1-16)。
 * 设为 16:平衡吞吐和 fd 占用,5000 个反馈文件 ~6 秒读完(假设每文件 1ms),
 * 远小于单进程默认 fd 上限(1024 on Linux)。Windows 上限更高,无需调整。
 */
const FEEDBACK_CONCURRENCY = 16;

/** 单个 wheel 的累计反馈记录 */
export interface FeedbackRecord {
  /** wheel 标识(GitHub 源为 owner/repo) */
  name: string;
  /** 数据源(github/npm/...), 元数据用于未来按源筛选 */
  source: string;
  /** 累计 like 次数 */
  likes: number;
  /** 累计 hide 次数 */
  hides: number;
  /** 累计 click 次数 */
  clicks: number;
  /** 最后更新时间戳(ms) */
  lastUpdated: number;
  /** 最后一次动作类型 */
  lastAction: FeedbackAction;
}

/**
 * 反馈记录 schema(P0-1:反序列化校验)。
 * 反馈是跨会话持久化数据,磁盘文件可能因手动编辑/版本升级/磁盘损坏等原因含异常字段。
 * safeParse 失败 → 返回 null(视为该 wheel 无反馈记录),并 logError 记录原因。
 * 不删除损坏的反馈文件(用户持久数据,需保留以便人工恢复)。
 */
const FeedbackRecordSchema = z.object({
  name: z.string(),
  source: z.string(),
  likes: z.number(),
  hides: z.number(),
  clicks: z.number(),
  lastUpdated: z.number(),
  lastAction: z.enum(['like', 'hide', 'click']),
});

/** 安全解析反馈记录:JSON 解析 + zod 校验,失败返回 null */
function safeParseFeedback(raw: string): FeedbackRecord | null {
  try {
    const obj = JSON.parse(raw);
    const parsed = FeedbackRecordSchema.safeParse(obj);
    if (!parsed.success) {
      logError('feedback parse failed', parsed.error);
      return null;
    }
    return parsed.data;
  } catch (err) {
    logError('feedback parse failed', err);
    return null;
  }
}

export interface FeedbackStoreOpts {
  /** 存储目录, 默认 ~/.findawheel/feedback/ */
  dir: string;
  /** 是否启用(默认 true, 测试可关闭) */
  enabled?: boolean;
}

/** 计算 feedback 文件名: feedback-<sha1(name)[0..24]>.json */
export function feedbackFileKey(name: string): string {
  return 'feedback-' + sha1Short(name);
}

/**
 * 创建反馈存储实例。
 * 所有方法容错: 磁盘错误不抛异常, 返回 null 或空数组, 不阻断主流程。
 */
export function createFeedbackStore(opts: FeedbackStoreOpts) {
  const enabled = opts.enabled ?? true;

  // 进程内内存缓存:避免每次搜索都全量读盘(readdir + 读所有文件)。
  // MCP server 是长期运行的 stdio 进程,反馈文件持续累积后全量读盘开销显著。
  // 缓存策略:首次 getAllFeedback 读盘后缓存,recordFeedback 时失效,60s 自动过期防陈旧。
  let feedbackCache: FeedbackRecord[] | null = null;
  let feedbackCacheTime = 0;
  const FEEDBACK_MEM_CACHE_TTL_MS = 60_000;

  function filePath(name: string): string {
    return path.join(opts.dir, `${feedbackFileKey(name)}.json`);
  }

  /**
   * 读取单个 wheel 的反馈记录。
   * 不存在或读取失败返回 null。
   */
  async function getFeedback(name: string): Promise<FeedbackRecord | null> {
    if (!enabled) return null;
    const file = filePath(name);
    let raw: string;
    try {
      raw = await fs.promises.readFile(file, 'utf8');
    } catch (err) {
      logError('feedback read failed', err);
      return null;
    }
    // P0-1:用 zod schema 校验,损坏文件返回 null
    return safeParseFeedback(raw);
  }

  /**
   * 记录一次反馈动作。
   * 累加对应计数, 更新 lastUpdated 和 lastAction。
   * 容错: 磁盘写入失败不抛异常, 返回 null。
   * @returns 更新后的记录; 失败返回 null
   */
  async function recordFeedback(
    name: string,
    action: FeedbackAction,
    source: string = 'github',
  ): Promise<FeedbackRecord | null> {
    if (!enabled) return null;
    const existing = await getFeedback(name);
    const now = Date.now();
    // 显式构造新对象,避免 existing 非空时 record 与 existing 共享引用导致 mutation 污染
    const record: FeedbackRecord = { ...(existing ?? {
      name,
      source,
      likes: 0,
      hides: 0,
      clicks: 0,
      lastUpdated: now,
      lastAction: action,
    }) };
    // 累加计数
    if (action === 'like') record.likes += 1;
    else if (action === 'hide') record.hides += 1;
    else if (action === 'click') record.clicks += 1;
    record.lastUpdated = now;
    record.lastAction = action;
    // 确保 source 字段正确(可能之前存的 source 与现在不同)
    record.source = source;

    try {
      await fs.promises.mkdir(opts.dir, { recursive: true });
      await fs.promises.writeFile(filePath(name), JSON.stringify(record), 'utf8');
      logInfo(`feedback recorded: ${name} ${action} (likes=${record.likes} hides=${record.hides} clicks=${record.clicks})`);
      // write-through 增量更新:缓存有效则合并新记录,避免下次 getAllFeedback 全量读盘;
      // 缓存不存在或已过期则置 null,下次 getAllFeedback 全量同步(60s TTL 防止增量漂移)。
      // 写入成功后才更新缓存,保证缓存与磁盘一致。
      if (feedbackCache && Date.now() - feedbackCacheTime < FEEDBACK_MEM_CACHE_TTL_MS) {
        const idx = feedbackCache.findIndex(r => r.name === record.name);
        if (idx >= 0) {
          feedbackCache[idx] = record;
        } else {
          feedbackCache.push(record);
        }
      } else {
        feedbackCache = null;
      }
    } catch (err) {
      logError('feedback write failed', err);
      // 写入失败不阻断, 返回 null 提示调用方
      // 不更新 feedbackCache(保持旧值,与磁盘一致)
      return null;
    }
    return record;
  }

  /**
   * 列出所有已记录反馈的 wheel。
   * 用于批量加载到排序加权。读取失败返回空数组。
   *
   * P1-16:加并发上限,避免反馈文件特别多时同时打开过多 fd 触发 EMFILE。
   * 用 batch 模式分批读取,每批 FEEDBACK_CONCURRENCY 个文件并行。
   */
  async function getAllFeedback(): Promise<FeedbackRecord[]> {
    if (!enabled) return [];
    // 内存缓存命中:避免每次搜索都全量读盘
    if (feedbackCache && Date.now() - feedbackCacheTime < FEEDBACK_MEM_CACHE_TTL_MS) {
      return feedbackCache;
    }
    let files: string[];
    try {
      files = await fs.promises.readdir(opts.dir);
    } catch (err) {
      logError('feedback list failed', err);
      return [];
    }
    const feedbackFiles = files.filter(f => f.startsWith('feedback-') && f.endsWith('.json'));
    const records: FeedbackRecord[] = [];
    // 分批读取,避免高 fd 占用
    for (let i = 0; i < feedbackFiles.length; i += FEEDBACK_CONCURRENCY) {
      const batch = feedbackFiles.slice(i, i + FEEDBACK_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async (f) => {
          const raw = await fs.promises.readFile(path.join(opts.dir, f), 'utf8');
          return safeParseFeedback(raw);
        }),
      );
      for (const r of settled) {
        if (r.status === 'fulfilled' && r.value) {
          records.push(r.value);
        } else if (r.status === 'rejected') {
          logError('feedback file read failed', r.reason);
        }
      }
    }
    // 写入内存缓存
    feedbackCache = records;
    feedbackCacheTime = Date.now();
    return records;
  }

  return { getFeedback, recordFeedback, getAllFeedback };
}

export type FeedbackStore = ReturnType<typeof createFeedbackStore>;
