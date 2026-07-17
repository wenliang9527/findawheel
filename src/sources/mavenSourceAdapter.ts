// src/sources/mavenSourceAdapter.ts
// Maven Central 适配器 —— 补「Java/Kotlin/JVM 生态」盲区。
//
// 关键差异(对比其他源):
// 1. 无需鉴权:search.maven.org 公开 Solr 搜索接口,匿名调用即可
// 2. GET 请求,响应为 JSON(Solr select 风格)
// 3. 主要补 JVM 生态:用户搜 Spring Boot / Kafka 客户端 / Android 库时能找到 Maven 坐标
// 4. 返回 groupId:artifactId 坐标、最新版本、仓库 ID、最后更新时间
// 5. 搜索 API 不返回描述信息(需二次请求 gav core 接口),为简化搜索阶段 description 留空
//
// 端点: GET https://search.maven.org/solrsearch/select?q=<q>&rows=20&wt=json
// timestamp 字段为毫秒级 Unix 时间戳,转 ISO 用 new Date(ts).toISOString()

import type { SourceAdapter, SearchOpts } from './sourceAdapter.js';
import type { MavenRawResult, RawResult } from '../normalize/types.js';
import { httpGet } from '../util/http.js';
import { DEFAULT_RETRY } from '../util/retry.js';
import { translateQuery } from '../classifier/queryTranslator.js';
import { toSourceError } from './sourceError.js';

const API_BASE = 'https://search.maven.org/solrsearch/select';
const DEFAULT_ROWS = 20;

/** Maven Solr 搜索响应(只取我们关心的字段) */
interface MavenSearchResponse {
  response: {
    docs: Array<{
      /** 坐标,形如 "groupId:artifactId" */
      id: string;
      /** groupId */
      g: string;
      /** artifactId */
      a: string;
      /** 最新版本 */
      latestVersion: string;
      /** 仓库 ID(通常为 "central") */
      repositoryId?: string;
      /** 最后更新时间(毫秒级 Unix 时间戳) */
      timestamp?: number;
    }>;
  };
}

/**
 * Maven Central 搜索适配器。
 *
 * 触发场景:用户搜 "spring boot web" / "kafka client" / "android json" 等 JVM 生态相关 query 时,
 * 补充 Maven 坐标召回,避免只找到 GitHub 源码而找不到正式发布的 artifact。
 *
 * 限流:search.maven.org 无明确文档,但匿名调用配额充足(配合磁盘缓存足够)。
 * 容错:API 失败时抛 SourceError,由 findWheelTool 标记为 degraded 不阻断主流程。
 *
 * 设计取舍:搜索阶段不抓 description(需二次请求 gav core 接口,延迟翻倍),
 * description 留空字符串,由后续 enrich 阶段或 AI 调用方按需补全。
 */
export class MavenSourceAdapter implements SourceAdapter {
  readonly name = 'maven';

  async search(query: string, opts: SearchOpts): Promise<RawResult[]> {
    // 优先复用 parsedQuery.expandedQuery,避免单次请求内重复翻译
    const q = opts.parsedQuery?.expandedQuery ?? translateQuery(query);
    const url = new URL(API_BASE);
    url.searchParams.set('q', q);
    url.searchParams.set('rows', String(DEFAULT_ROWS));
    url.searchParams.set('wt', 'json');

    try {
      const data = await httpGet<MavenSearchResponse>(url.toString(), {
        timeoutMs: opts.timeoutMs,
        retry: DEFAULT_RETRY,
      });

      // 防御:response 或 docs 缺失时容错为空数组(API 异常不阻断)
      const docs = data?.response?.docs ?? [];

      return docs.map((d): MavenRawResult => ({
        source: 'maven',
        // name 用 g:a 坐标格式(优先用解析出的 g/a,兜底用 id 字段)
        name: d.g && d.a ? `${d.g}:${d.a}` : d.id,
        // Maven Central 详情页 URL
        url: d.g && d.a
          ? `https://central.sonatype.com/artifact/${d.g}/${d.a}`
          : `https://central.sonatype.com/artifact/${d.id}`,
        // 搜索 API 不返回描述,用 artifactId 兜底生成(避免二次请求翻倍延迟)
        description: d.a ? `Maven artifact: ${d.a}` : '',
        version: d.latestVersion ?? '',
        // timestamp 为毫秒级,转 ISO;缺失则不填(留 undefined)
        lastUpdated: d.timestamp ? new Date(d.timestamp).toISOString() : undefined,
        repository: d.repositoryId,
      }));
    } catch (err) {
      throw toSourceError('maven', err);
    }
  }
}
