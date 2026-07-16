// src/sources/rubygemsSourceAdapter.ts
// RubyGems 适配器 —— 补「Ruby 生态包」盲区。
//
// 关键差异(对比其他源):
// 1. 无需 key(公开 API,无限流限制)
// 2. GET 请求,可用 httpGet
// 3. 主要补 Ruby 场景:用户搜 "rails" "sinatra" "devise" 等 Ruby gem 时能找到
// 4. 返回 gem 名/版本/下载量/最近更新时间/许可证
// 5. 响应是 JSON 数组(非 { results: [...] } 结构)
//
// 端点: GET https://rubygems.org/api/v1/search.json?query=<query>
//
// 实现要点:
// - 中文 query 用 translateQuery 翻译成英文,提升命中率
// - description 优先用 description 字段,为空则用 summary
// - license 取 licenses[0]
// - url 用 project_uri
// - updatedAt 用 version_created_at

import type { SourceAdapter, SearchOpts } from './sourceAdapter.js';
import type { RubyGemsRawResult, RawResult } from '../normalize/types.js';
import { httpGet } from '../util/http.js';
import { DEFAULT_RETRY } from '../util/retry.js';
import { translateQuery } from '../classifier/queryTranslator.js';
import { toSourceError } from './sourceError.js';

const API_BASE = 'https://rubygems.org/api/v1';

/** RubyGems API 单个 gem 的响应字段(只取我们关心的) */
interface RubyGemsApiResponse {
  name: string;
  full_name?: string;
  version: string;
  description?: string;
  summary?: string;
  downloads: number;
  version_created_at: string;
  version_downloads?: number;
  homepage_uri?: string;
  source_code_uri?: string;
  gem_uri?: string;
  project_uri?: string;
  licenses?: string[];
}

interface RubyGemsSearchResponse extends Array<RubyGemsApiResponse> {}

/**
 * RubyGems 包搜索适配器。
 *
 * 触发场景:用户搜 "rails" "sinatra" "devise" "sidekiq" 等 Ruby 生态关键词时,
 * 补充 RubyGems 包召回,避免只找到 GitHub 仓库而找不到正式发布的 gem。
 *
 * 限流:RubyGems API 无明确限流,但仍限制结果数(默认返回按相关性排序的结果)。
 * 容错:API 失败时抛 SourceError,由 findWheelTool 标记为 degraded 不阻断主流程。
 */
export class RubyGemsSourceAdapter implements SourceAdapter {
  readonly name = 'rubygems';

  async search(query: string, opts: SearchOpts): Promise<RawResult[]> {
    // 优先复用 parsedQuery.expandedQuery,避免单次请求内重复翻译
    const expandedQuery = opts.parsedQuery?.expandedQuery ?? translateQuery(query);
    const url = new URL(`${API_BASE}/search.json`);
    url.searchParams.set('query', expandedQuery);

    try {
      // RubyGems 公开 API,匿名调用即可(无明确限流)
      const data = await httpGet<RubyGemsSearchResponse>(url.toString(), {
        timeoutMs: opts.timeoutMs,
        retry: DEFAULT_RETRY,
      });

      // 防御:正常应返回数组,异常情况容错为空数组
      const gems = Array.isArray(data) ? data : [];

      return gems.map((g): RubyGemsRawResult => ({
        source: 'rubygems',
        name: g.name,
        // url 用 project_uri,缺失时回退到 RubyGems 包页面
        url: g.project_uri ?? `https://rubygems.org/gems/${g.name}`,
        // description 优先用 description,为空则用 summary,再为空给空串
        description: pickDescription(g),
        version: g.version,
        downloads: g.downloads ?? 0,
        // updatedAt 用 version_created_at
        updatedAt: g.version_created_at ?? '',
        // license 取 licenses[0]
        license: pickLicense(g),
        sourceCodeUri: g.source_code_uri,
      }));
    } catch (err) {
      throw toSourceError('rubygems', err);
    }
  }
}

/** 选取描述:优先 description,为空则用 summary */
function pickDescription(g: RubyGemsApiResponse): string {
  const desc = g.description?.trim();
  if (desc) return desc;
  const summary = g.summary?.trim();
  if (summary) return summary;
  return '';
}

/** 选取 license:取 licenses 数组的第一个元素 */
function pickLicense(g: RubyGemsApiResponse): string | undefined {
  if (Array.isArray(g.licenses) && g.licenses.length > 0) {
    return g.licenses[0];
  }
  return undefined;
}
