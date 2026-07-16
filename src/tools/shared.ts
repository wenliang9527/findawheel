// src/tools/shared.ts
// tools 共享的工具函数(消除 tools 之间的反向依赖)。
// detailsCacheKey 原定义在 getWheelDetailsTool.ts,但 findWheelTool 反向依赖它,
// 将其下沉到本共享模块,避免 tools 内部相互依赖。

import { sha1Short } from '../util/hash.js';

/** 计算 details cache key:sha1("details:" + name) */
export function detailsCacheKey(name: string): string {
  return sha1Short(`details:${name}`);
}
