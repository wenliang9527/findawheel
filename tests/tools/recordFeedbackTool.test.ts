// tests/tools/recordFeedbackTool.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createRecordFeedbackTool } from '../../src/tools/recordFeedbackTool.js';
import { createFeedbackStore } from '../../src/feedback/feedbackStore.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let dirCounter = 0;
function tmpDir(): string {
  dirCounter += 1;
  return path.join(os.tmpdir(), `fw-record-test-${process.pid}-${dirCounter}`);
}

describe('recordFeedbackTool.handle', () => {
  it('rejects empty name', async () => {
    const store = createFeedbackStore({ dir: tmpDir() });
    const tool = createRecordFeedbackTool({ store });
    const res = await tool.handle({ name: '', action: 'like' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('invalid name');
  });

  it('rejects name without / (not owner/repo)', async () => {
    const store = createFeedbackStore({ dir: tmpDir() });
    const tool = createRecordFeedbackTool({ store });
    const res = await tool.handle({ name: 'justname', action: 'like' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('invalid name');
  });

  it('rejects invalid action', async () => {
    const store = createFeedbackStore({ dir: tmpDir() });
    const tool = createRecordFeedbackTool({ store });
    const res = await tool.handle({ name: 'a/b', action: 'love' as never });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('invalid action');
  });

  it('records like and returns updated counts', async () => {
    const dir = tmpDir();
    fs.rmSync(dir, { recursive: true, force: true });
    const store = createFeedbackStore({ dir });
    const tool = createRecordFeedbackTool({ store });
    const res = await tool.handle({ name: 'a/b', action: 'like' });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);
    expect(payload.name).toBe('a/b');
    expect(payload.action).toBe('like');
    expect(payload.totalLikes).toBe(1);
    expect(payload.totalHides).toBe(0);
    expect(payload.totalClicks).toBe(0);
    expect(payload.lastAction).toBe('like');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('accumulates feedback across multiple calls', async () => {
    const dir = tmpDir();
    fs.rmSync(dir, { recursive: true, force: true });
    const store = createFeedbackStore({ dir });
    const tool = createRecordFeedbackTool({ store });
    await tool.handle({ name: 'a/b', action: 'like' });
    await tool.handle({ name: 'a/b', action: 'like' });
    await tool.handle({ name: 'a/b', action: 'click' });
    await tool.handle({ name: 'a/b', action: 'hide' });
    const res = await tool.handle({ name: 'a/b', action: 'like' });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.totalLikes).toBe(3);
    expect(payload.totalClicks).toBe(1);
    expect(payload.totalHides).toBe(1);
    expect(payload.lastAction).toBe('like');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns in-memory message when store returns null (disabled)', async () => {
    const dir = tmpDir();
    fs.rmSync(dir, { recursive: true, force: true });
    const store = createFeedbackStore({ dir, enabled: false });
    const tool = createRecordFeedbackTool({ store });
    const res = await tool.handle({ name: 'a/b', action: 'like' });
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain('in-memory only');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('persists feedback across tool instances (new process simulation)', async () => {
    const dir = tmpDir();
    fs.rmSync(dir, { recursive: true, force: true });
    // 第一次: 记录反馈
    const store1 = createFeedbackStore({ dir });
    const tool1 = createRecordFeedbackTool({ store: store1 });
    await tool1.handle({ name: 'a/b', action: 'like' });
    // 第二次: 新 store 实例(模拟新进程), 记录新反馈
    const store2 = createFeedbackStore({ dir });
    const tool2 = createRecordFeedbackTool({ store: store2 });
    const res = await tool2.handle({ name: 'a/b', action: 'like' });
    // 累计 likes 应为 2
    const payload = JSON.parse(res.content[0].text);
    expect(payload.totalLikes).toBe(2);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
