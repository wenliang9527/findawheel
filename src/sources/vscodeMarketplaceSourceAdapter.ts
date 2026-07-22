// src/sources/vscodeMarketplaceSourceAdapter.ts
// VS Code Marketplace 适配器 —— 补「IDE 插件」盲区。
//
// 关键差异(对比 GitHub):
// 1. POST 请求,非 GET(走 httpPost,共享超时/重试/错误处理)
// 2. 无需 key(路径含 _apis/public,公开 API)
// 3. 非官方文档化 API,微软未承诺 SLA,结构可能变更
// 4. 请求体是 GraphQL-like 结构,filterType=8 是 SearchText
// 5. 结果结构嵌套深,需逐层解构提取
//
// 参考:VS Code 客户端内部使用的 API,社区已稳定使用多年。

import type { SourceAdapter, SearchOpts } from './sourceAdapter.js';
import type { VscodeExtensionRawResult, RawResult } from '../normalize/types.js';
import { httpPost } from '../util/http.js';
import { DEFAULT_RETRY } from '../util/retry.js';
import { toSourceError } from '../util/sourceError.js';

const MARKETPLACE_URL = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';

// flag 914 = IncludeVersionProperties(2) + IncludeAssetUri(512) + IncludeStatistics(128) + IncludeFiles(256) + ...
// 实际只用 914 让 Marketplace 返回统计信息(installCount/rating)
const QUERY_FLAGS = 914;

// VS Code Marketplace filterType 枚举(非官方,源自 VS Code 客户端内部协议)
// 8 = SearchText(按搜索词匹配),12 = TargetVSCode(限定 VS Code 扩展)
const FILTER_TYPE_SEARCH_TEXT = 8;
const FILTER_TYPE_TARGET_VSCODE = 12;

interface MarketplaceCriteria {
  filterType: number;
  value: string;
}

interface MarketplaceRequestBody {
  filters: Array<{
    criteria: MarketplaceCriteria[];
  }>;
  assetTypes: string[];
  flags: number;
}

interface MarketplaceResponse {
  results: Array<{
    extensions: Array<{
      publisherId: string;
      publisherName: string;
      publisherDisplayName: string;
      extensionName: string;
      displayName: string;
      flags: string;
      shortDescription: string;
      versions: Array<{
        version: string;
        lastUpdated: string;
        assetUri: string;
      }>;
      statistics: Array<{
        statisticName: string;
        value: number;
      }>;
      tags: string[];
    }>;
    resultMetadata: Array<{
      metadataType: string;
      metadataItems: Array<{ name: string; count: number }>;
    }>;
  }>;
}

/**
 * 从 statistics 数组里提取指定统计项的值
 */
function extractStat(stats: Array<{ statisticName: string; value: number }>, name: string): number | undefined {
  const found = stats.find(s => s.statisticName === name);
  return found ? found.value : undefined;
}

export class VscodeMarketplaceSourceAdapter implements SourceAdapter {
  readonly name = 'vscode-marketplace';

  async search(query: string, opts: SearchOpts): Promise<RawResult[]> {
    // 构造 POST body
    const body: MarketplaceRequestBody = {
      filters: [{
        criteria: [
          { filterType: FILTER_TYPE_SEARCH_TEXT, value: query },
          { filterType: FILTER_TYPE_TARGET_VSCODE, value: 'Microsoft.VisualStudio.Code' },
        ],
      }],
      assetTypes: [],
      flags: QUERY_FLAGS,
    };

    try {
      const data = await httpPost<MarketplaceResponse>(MARKETPLACE_URL, {
        timeoutMs: opts.timeoutMs,
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json;api-version=3.0-preview.1',
        },
        body: JSON.stringify(body),
        retry: DEFAULT_RETRY,
      });

      // Marketplace 返回结构嵌套: results[0].extensions[]
      const extensions = data.results?.[0]?.extensions ?? [];
      return extensions.map((ext): VscodeExtensionRawResult => {
        const publisher = ext.publisherName;
        const extName = ext.extensionName;
        const fullName = `${publisher}.${extName}`;
        const lastVersion = ext.versions?.[0];
        return {
          source: 'vscode-marketplace',
          name: fullName,
          url: `https://marketplace.visualstudio.com/items?itemName=${fullName}`,
          description: ext.displayName
            ? `${ext.displayName} - ${ext.shortDescription ?? ''}`.trim()
            : (ext.shortDescription ?? ''),
          installCount: extractStat(ext.statistics ?? [], 'install') ?? 0,
          averageRating: extractStat(ext.statistics ?? [], 'averagerating'),
          ratingCount: extractStat(ext.statistics ?? [], 'ratingcount'),
          lastUpdated: lastVersion?.lastUpdated ?? '',
          publisher,
        };
      });
    } catch (err) {
      // HttpError(4xx 等):转 SourceError,保留状态码
      // 其余(5xx 包装出的 RetryableError / 网络错误 / abort)统一转 SourceError
      throw toSourceError('vscode-marketplace', err);
    }
  }
}
