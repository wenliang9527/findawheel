// tests/tools/helpers.ts
// tests/tools/ 下多个测试文件共享的 fixture 构造函数(P1-15 抽离)。
// 避免在 findWheelTool.test.ts / findWheelToolFeedback.test.ts /
// findWheelToolHybrid.test.ts / findWheelToolAiCollaboration.test.ts 重复定义。
import * as path from 'node:path';
import * as os from 'node:os';
import type { SourceAdapter, SearchOpts } from '../../src/sources/sourceAdapter.js';
import type { RawResult } from '../../src/normalize/types.js';
import { SourceError } from '../../src/errors.js';

let dirCounter = 0;

/**
 * 生成临时目录路径(不创建)。同进程多次调用返回不同路径。
 * @param prefix 文件名前缀,默认 'fw-test'
 */
export function makeTmpDir(prefix = 'fw-test'): string {
  dirCounter += 1;
  return path.join(os.tmpdir(), `${prefix}-${process.pid}-${dirCounter}`);
}

/**
 * 构造一个返回固定结果的 mock adapter。
 * @param results 搜索返回的 RawResult 列表
 * @param name adapter 名称(默认 'github')
 */
export function makeMockAdapter(
  results: RawResult[],
  name = 'github',
): SourceAdapter {
  return {
    name,
    async search(_q: string, _o: SearchOpts): Promise<RawResult[]> { return results; },
  };
}

/**
 * 构造一个永远抛 SourceError 的失败 adapter。
 */
export function makeFailingAdapter(name: string): SourceAdapter {
  return {
    name,
    async search(): Promise<RawResult[]> { throw new SourceError(name, 'down'); },
  };
}

/**
 * 构造一个 github 源 RawResult,字段给默认值。
 * @param name owner/repo 格式
 * @param opts 可选字段覆盖
 *   - desc: description(默认 'markdown editor library')
 *   - stars: stars 数(默认 100)
 *   - pushedAt: pushedAt(默认 '2025-06-01T00:00:00Z')
 */
export function makeGhResult(
  name: string,
  opts: { desc?: string; stars?: number; pushedAt?: string } = {},
): RawResult {
  return {
    source: 'github',
    name,
    url: `https://github.com/${name}`,
    description: opts.desc ?? 'markdown editor library',
    stars: opts.stars ?? 100,
    language: null,
    license: 'MIT',
    archived: false,
    pushedAt: opts.pushedAt ?? '2025-06-01T00:00:00Z',
    topics: [],
  };
}
