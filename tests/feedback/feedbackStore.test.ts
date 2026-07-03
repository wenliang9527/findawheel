// tests/feedback/feedbackStore.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFeedbackStore, feedbackFileKey } from '../../src/feedback/feedbackStore.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let dirCounter = 0;
let tmpDir: string;

beforeEach(() => {
  dirCounter += 1;
  tmpDir = path.join(os.tmpdir(), `fw-feedback-test-${process.pid}-${dirCounter}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('feedbackFileKey', () => {
  it('is deterministic for same name', () => {
    expect(feedbackFileKey('owner/repo')).toBe(feedbackFileKey('owner/repo'));
  });

  it('differs for different names', () => {
    expect(feedbackFileKey('a/b')).not.toBe(feedbackFileKey('c/d'));
  });

  it('starts with feedback- prefix', () => {
    expect(feedbackFileKey('a/b')).toMatch(/^feedback-/);
  });
});

describe('createFeedbackStore', () => {
  it('getFeedback returns null when record does not exist', async () => {
    const store = createFeedbackStore({ dir: tmpDir });
    expect(await store.getFeedback('a/b')).toBeNull();
  });

  it('recordFeedback creates new record with correct counts', async () => {
    const store = createFeedbackStore({ dir: tmpDir });
    const record = await store.recordFeedback('a/b', 'like');
    expect(record).not.toBeNull();
    expect(record!.name).toBe('a/b');
    expect(record!.source).toBe('github');
    expect(record!.likes).toBe(1);
    expect(record!.hides).toBe(0);
    expect(record!.clicks).toBe(0);
    expect(record!.lastAction).toBe('like');
    expect(record!.lastUpdated).toBeGreaterThan(0);
  });

  it('recordFeedback persists to disk and can be read back', async () => {
    const store = createFeedbackStore({ dir: tmpDir });
    await store.recordFeedback('a/b', 'like');
    // 新建 store 模拟新进程, 验证持久化
    const store2 = createFeedbackStore({ dir: tmpDir });
    const record = await store2.getFeedback('a/b');
    expect(record).not.toBeNull();
    expect(record!.name).toBe('a/b');
    expect(record!.likes).toBe(1);
  });

  it('recordFeedback accumulates counts across multiple calls', async () => {
    const store = createFeedbackStore({ dir: tmpDir });
    await store.recordFeedback('a/b', 'like');
    await store.recordFeedback('a/b', 'like');
    await store.recordFeedback('a/b', 'click');
    await store.recordFeedback('a/b', 'like');
    const record = await store.getFeedback('a/b');
    expect(record!.likes).toBe(3);
    expect(record!.clicks).toBe(1);
    expect(record!.hides).toBe(0);
    expect(record!.lastAction).toBe('like');
  });

  it('recordFeedback updates lastAction on each call', async () => {
    const store = createFeedbackStore({ dir: tmpDir });
    await store.recordFeedback('a/b', 'like');
    await store.recordFeedback('a/b', 'hide');
    await store.recordFeedback('a/b', 'click');
    const record = await store.getFeedback('a/b');
    expect(record!.lastAction).toBe('click');
  });

  it('recordFeedback accepts custom source', async () => {
    const store = createFeedbackStore({ dir: tmpDir });
    const record = await store.recordFeedback('pkg', 'like', 'npm');
    expect(record!.source).toBe('npm');
  });

  it('getAllFeedback returns empty array when dir does not exist', async () => {
    const store = createFeedbackStore({ dir: path.join(tmpDir, 'nonexistent') });
    expect(await store.getAllFeedback()).toEqual([]);
  });

  it('getAllFeedback returns all recorded feedbacks', async () => {
    const store = createFeedbackStore({ dir: tmpDir });
    await store.recordFeedback('a/b', 'like');
    await store.recordFeedback('c/d', 'hide');
    await store.recordFeedback('e/f', 'click');
    const all = await store.getAllFeedback();
    expect(all).toHaveLength(3);
    const names = all.map(r => r.name).sort();
    expect(names).toEqual(['a/b', 'c/d', 'e/f']);
  });

  it('getAllFeedback skips corrupted files gracefully', async () => {
    const store = createFeedbackStore({ dir: tmpDir });
    await store.recordFeedback('a/b', 'like');
    // 写一个损坏的 feedback 文件
    const badFile = path.join(tmpDir, 'feedback-corrupted.json');
    await fs.promises.writeFile(badFile, '{ invalid json', 'utf8');
    const all = await store.getAllFeedback();
    // 损坏文件被跳过, 只返回有效记录
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('a/b');
  });

  it('enabled=false makes all methods no-op', async () => {
    const store = createFeedbackStore({ dir: tmpDir, enabled: false });
    expect(await store.recordFeedback('a/b', 'like')).toBeNull();
    expect(await store.getFeedback('a/b')).toBeNull();
    expect(await store.getAllFeedback()).toEqual([]);
    // 不应写文件
    expect(fs.existsSync(tmpDir)).toBe(false);
  });

  it('recordFeedback returns null when disk write fails', async () => {
    const store = createFeedbackStore({ dir: tmpDir });
    // mock writeFile 抛错模拟磁盘失败(跨平台, 不依赖 chmod)
    const spy = vi.spyOn(fs.promises, 'writeFile').mockRejectedValue(new Error('disk full'));
    const result = await store.recordFeedback('a/b', 'like');
    expect(result).toBeNull();
    spy.mockRestore();
  });

  it('different wheels get different files', async () => {
    const store = createFeedbackStore({ dir: tmpDir });
    await store.recordFeedback('a/b', 'like');
    await store.recordFeedback('c/d', 'hide');
    const ab = await store.getFeedback('a/b');
    const cd = await store.getFeedback('c/d');
    expect(ab!.likes).toBe(1);
    expect(ab!.hides).toBe(0);
    expect(cd!.hides).toBe(1);
    expect(cd!.likes).toBe(0);
  });
});
