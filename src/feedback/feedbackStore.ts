// src/feedback/feedbackStore.ts
// 本地反馈存储层: 持久化用户对 wheel 的反馈(like/hide/click),用于后续排序加权。
// 存储位置: ~/.findawheel/feedback/<feedback-key>.json
// 与 cache/ 分离: 反馈是持久用户数据, 不参与 TTL 过期。
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { logError } from '../util/logger.js';

/** 反馈动作类型 */
export type FeedbackAction = 'like' | 'hide' | 'click';

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

export interface FeedbackStoreOpts {
  /** 存储目录, 默认 ~/.findawheel/feedback/ */
  dir: string;
  /** 是否启用(默认 true, 测试可关闭) */
  enabled?: boolean;
}

/** 计算 feedback 文件名: feedback-<sha1(name)[0..24]>.json */
export function feedbackFileKey(name: string): string {
  return 'feedback-' + crypto.createHash('sha1').update(name).digest('hex').slice(0, 24);
}

/**
 * 创建反馈存储实例。
 * 所有方法容错: 磁盘错误不抛异常, 返回 null 或空数组, 不阻断主流程。
 */
export function createFeedbackStore(opts: FeedbackStoreOpts) {
  const enabled = opts.enabled ?? true;

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
    try {
      return JSON.parse(raw) as FeedbackRecord;
    } catch (err) {
      logError('feedback parse failed', err);
      return null;
    }
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
    const record: FeedbackRecord = existing ?? {
      name,
      source,
      likes: 0,
      hides: 0,
      clicks: 0,
      lastUpdated: now,
      lastAction: action,
    };
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
    } catch (err) {
      logError('feedback write failed', err);
      // 写入失败不阻断, 返回 null 提示调用方
      return null;
    }
    return record;
  }

  /**
   * 列出所有已记录反馈的 wheel。
   * 用于批量加载到排序加权。读取失败返回空数组。
   */
  async function getAllFeedback(): Promise<FeedbackRecord[]> {
    if (!enabled) return [];
    let files: string[];
    try {
      files = await fs.promises.readdir(opts.dir);
    } catch (err) {
      logError('feedback list failed', err);
      return [];
    }
    const records: FeedbackRecord[] = [];
    await Promise.all(
      files
        .filter(f => f.startsWith('feedback-') && f.endsWith('.json'))
        .map(async (f) => {
          try {
            const raw = await fs.promises.readFile(path.join(opts.dir, f), 'utf8');
            records.push(JSON.parse(raw) as FeedbackRecord);
          } catch (err) {
            logError('feedback file parse failed', err);
            // 单个文件损坏跳过
          }
        }),
    );
    return records;
  }

  return { getFeedback, recordFeedback, getAllFeedback };
}

export type FeedbackStore = ReturnType<typeof createFeedbackStore>;
