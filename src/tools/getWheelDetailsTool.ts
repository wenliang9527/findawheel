// src/tools/getWheelDetailsTool.ts
import type { Wheel } from '../normalize/types.js';
import {
  enrichDetails,
  type WheelDetails,
  type EnrichDetailsOpts,
} from '../enrich/wheelDetailsEnricher.js';
import { type Cache } from '../cache/cache.js';
import * as crypto from 'node:crypto';
import type { McpToolResult } from './types.js';

export interface GetWheelDetailsInput {
  /** GitHub 仓库标识,owner/repo 格式 */
  name: string;
}

export interface CreateGetWheelDetailsToolOpts {
  /** 可选详情缓存实例(测试注入或与 findWheelTool 共享) */
  cache?: Cache<WheelDetails>;
  /** enrichDetails 所需配置(githubToken/userLicense/timeoutMs) */
  enrichOpts: EnrichDetailsOpts;
}

/** 计算 details cache key:sha1("details:" + name) */
export function detailsCacheKey(name: string): string {
  return crypto.createHash('sha1').update(`details:${name}`).digest('hex').slice(0, 24);
}

/**
 * get_wheel_details 工具:按需懒加载单个 wheel 的详情。
 * AI 先调 find_wheel 看摘要列表,对感兴趣的 wheel 再调此工具拿详情。
 * 缓存策略:优先查 findWheelTool 预抓取写入的 details 缓存,未命中则实时抓取。
 */
export function createGetWheelDetailsTool(opts: CreateGetWheelDetailsToolOpts) {
  const cache = opts.cache;

  async function handle(input: GetWheelDetailsInput): Promise<McpToolResult> {
    // 校验 name 格式:必须是 owner/repo
    if (!input.name.includes('/')) {
      return {
        content: [{ type: 'text', text: 'invalid name: expected owner/repo format' }],
        isError: true,
      };
    }

    const key = detailsCacheKey(input.name);

    // 查缓存(命中预抓取的 details 时秒回)
    if (cache) {
      const cached = await cache.get(key);
      if (cached) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ...cached, cached: true }) }],
        };
      }
    }

    // 构造最小 Wheel 用于 enrichDetails(实时抓取时 license 未知,licenseCheck 可能 unknown)
    const wheel: Wheel = {
      name: input.name,
      source: 'github',
      url: `https://github.com/${input.name}`,
      description: '',
      type: 'project',
      metrics: {},
    };

    const details = await enrichDetails(wheel, opts.enrichOpts);
    if (!details) {
      return {
        content: [{ type: 'text', text: 'no details available (non-GitHub source or fetch failed)' }],
        isError: true,
      };
    }

    // 写缓存(成功才缓存,失败不缓存避免毒化)
    if (cache) {
      await cache.set(key, details);
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(details) }],
    };
  }

  return { handle };
}
