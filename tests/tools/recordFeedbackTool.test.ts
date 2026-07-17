// tests/tools/recordFeedbackTool.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import { createRecordFeedbackTool } from '../../src/tools/recordFeedbackTool.js';
import { createFeedbackStore } from '../../src/feedback/feedbackStore.js';
import { makeTmpDir } from './helpers.js';

describe('recordFeedbackTool.handle', () => {
  it('rejects empty name', async () => {
    const store = createFeedbackStore({ dir: makeTmpDir('fw-record') });
    const tool = createRecordFeedbackTool({ store });
    const res = await tool.handle({ name: '', action: 'like' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('invalid name');
  });

  it('accepts non-owner/repo names (npm/crates/pypi etc., P0-1)', async () => {
    const dir = makeTmpDir('fw-record');
    fs.rmSync(dir, { recursive: true, force: true });
    const store = createFeedbackStore({ dir });
    const tool = createRecordFeedbackTool({ store });
    const res = await tool.handle({ name: 'lodash', action: 'like' });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);
    expect(payload.name).toBe('lodash');
    expect(payload.totalLikes).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects path traversal name (..)', async () => {
    const store = createFeedbackStore({ dir: makeTmpDir('fw-record') });
    const tool = createRecordFeedbackTool({ store });
    const res = await tool.handle({ name: '../etc/passwd', action: 'like' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('invalid name');
  });

  it('rejects whitespace-only name', async () => {
    const store = createFeedbackStore({ dir: makeTmpDir('fw-record') });
    const tool = createRecordFeedbackTool({ store });
    const res = await tool.handle({ name: '   ', action: 'like' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('invalid name');
  });

  it('passes source to store.recordFeedback (P2-4)', async () => {
    const dir = makeTmpDir('fw-record');
    fs.rmSync(dir, { recursive: true, force: true });
    const store = createFeedbackStore({ dir });
    const spy = vi.spyOn(store, 'recordFeedback');
    const tool = createRecordFeedbackTool({ store });
    const res = await tool.handle({ name: 'lodash', action: 'like', source: 'npm' });
    expect(res.isError).toBeFalsy();
    expect(spy).toHaveBeenCalledWith('lodash', 'like', 'npm');
    // 落盘后 source 字段应为 npm
    const record = await store.getFeedback('lodash');
    expect(record?.source).toBe('npm');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('omits source when not provided (store defaults to github, P2-4)', async () => {
    const dir = makeTmpDir('fw-record');
    fs.rmSync(dir, { recursive: true, force: true });
    const store = createFeedbackStore({ dir });
    const spy = vi.spyOn(store, 'recordFeedback');
    const tool = createRecordFeedbackTool({ store });
    await tool.handle({ name: 'a/b', action: 'like' });
    expect(spy).toHaveBeenCalledWith('a/b', 'like', undefined);
    const record = await store.getFeedback('a/b');
    expect(record?.source).toBe('github');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects invalid action', async () => {
    const store = createFeedbackStore({ dir: makeTmpDir('fw-record') });
    const tool = createRecordFeedbackTool({ store });
    const res = await tool.handle({ name: 'a/b', action: 'love' as never });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('invalid action');
  });

  it('records like and returns updated counts', async () => {
    const dir = makeTmpDir('fw-record');
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
    const dir = makeTmpDir('fw-record');
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
    const dir = makeTmpDir('fw-record');
    fs.rmSync(dir, { recursive: true, force: true });
    const store = createFeedbackStore({ dir, enabled: false });
    const tool = createRecordFeedbackTool({ store });
    const res = await tool.handle({ name: 'a/b', action: 'like' });
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain('in-memory only');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('persists feedback across tool instances (new process simulation)', async () => {
    const dir = makeTmpDir('fw-record');
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
