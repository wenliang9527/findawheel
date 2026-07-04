// src/sources/vscodeMarketplaceSourceAdapter.ts
// VS Code Marketplace 适配器 —— 补「IDE 插件」盲区。
//
// 关键差异(对比 GitHub):
// 1. POST 请求,非 GET(http.ts 只有 httpGet,这里直接用 fetch)
// 2. 无需 key(路径含 _apis/public,公开 API)
// 3. 非官方文档化 API,微软未承诺 SLA,结构可能变更
// 4. 请求体是 GraphQL-like 结构,filterType=8 是 SearchText
// 5. 结果结构嵌套深,需逐层解构提取
//
// 参考:VS Code 客户端内部使用的 API,社区已稳定使用多年。

import type { SourceAdapter, SearchOpts } from './sourceAdapter.js';
import type { VscodeExtensionRawResult, RawResult } from '../normalize/types.js';
import { SourceError } from '../errors.js';

const MARKETPLACE_URL = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';

// flag 914 = IncludeVersionProperties(2) + IncludeAssetUri(512) + IncludeStatistics(128) + IncludeFiles(256) + ...
// 实际只用 914 让 Marketplace 返回统计信息(installCount/rating)
const QUERY_FLAGS = 914;

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
          { filterType: 8, value: query },  // 8 = SearchText
          { filterType: 12, value: 'Microsoft.VisualStudio.Code' },  // 12 = TargetVSCode
        ],
      }],
      assetTypes: [],
      flags: QUERY_FLAGS,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

    try {
      const res = await fetch(MARKETPLACE_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json;api-version=3.0-preview.1',
          'user-agent': 'findawheel/0.1',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new SourceError('vscode-marketplace', `HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = (await res.json()) as MarketplaceResponse;

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
      if (err instanceof SourceError) throw err;
      // 网络错误 / abort
      throw new SourceError('vscode-marketplace', (err as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }
}
