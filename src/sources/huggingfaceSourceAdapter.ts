// src/sources/huggingfaceSourceAdapter.ts
// HuggingFace Hub 适配器 —— 补「AI 模型/数据集」盲区。
//
// 关键差异(对比其他源):
// 1. 无需 key(公开 API,但有限流;带 token 可提升额度)
// 2. GET 请求,可用 httpGet
// 3. 主要补 AI/ML 场景:用户搜"图像分割模型""语音识别模型"时能找到 pretrained model
// 4. 返回模型名/下载数/点赞数/最近更新时间
// 5. 模型名格式为 "org/model-name"(类似 GitHub 的 owner/repo)
//
// 端点: GET https://huggingface.co/api/models?search={query}&limit=20&full=false&sort=downloads&direction=-1
//
// D 阶段(2026-07-04):新增数据源,补 AI 模型盲区。

import type { SourceAdapter, SearchOpts } from './sourceAdapter.js';
import type { RawResult } from '../normalize/types.js';
import { httpGet, HttpError } from '../util/http.js';
import { SourceError } from '../errors.js';

const API_BASE = 'https://huggingface.co/api';
const DEFAULT_LIMIT = 20;

/** HuggingFace 模型原始字段(只取我们关心的) */
interface HfModel {
  id: string;              // "org/model-name"
  downloads: number;
  likes: number;
  lastModified: string;    // ISO date
  tags?: string[];
  pipeline_tag?: string;   // 任务类型,如 "text-classification"
  library_name?: string;   // 如 "transformers"/"pytorch"
}

interface HfSearchResponse extends Array<HfModel> {}

/**
 * HuggingFace 模型结果(扩展 RawResult 联合类型)。
 * 复用现有字段:name = model id, stars = likes(近似热度),
 * downloads = downloads, lastUpdated = lastModified。
 */
export interface HuggingfaceRawResult {
  source: 'huggingface';
  name: string;
  url: string;
  description: string;
  /** 点赞数(作为 stars 近似值,用于排序) */
  stars: number;
  /** 下载量 */
  downloads: number;
  /** 最近更新时间(ISO date) */
  lastUpdated: string;
  /** 任务类型,如 "text-classification" */
  pipelineTag?: string;
  /** 框架,如 "transformers"/"pytorch" */
  libraryName?: string;
}

/**
 * HuggingFace Hub 模型搜索适配器。
 *
 * 触发场景:用户搜"图像分割模型""语音识别""LLM 微调"等 AI/ML 相关 query 时,
 * 补充 pretrained model 召回,避免只找到代码库而找不到现成模型。
 *
 * 限流:无 token 时有较严格的限流(约 1000 req/h);带 token 可提升。
 * 容错:API 失败时抛 SourceError,由 findWheelTool 标记为 degraded 不阻断主流程。
 */
export class HuggingfaceSourceAdapter implements SourceAdapter {
  readonly name = 'huggingface';

  async search(query: string, opts: SearchOpts): Promise<RawResult[]> {
    const url = new URL(`${API_BASE}/models`);
    url.searchParams.set('search', query);
    url.searchParams.set('limit', String(DEFAULT_LIMIT));
    url.searchParams.set('full', 'false');
    // 按下载量降序,优先返回主流模型
    url.searchParams.set('sort', 'downloads');
    url.searchParams.set('direction', '-1');

    try {
      const data = await httpGet<HfSearchResponse>(url.toString(), {
        timeoutMs: opts.timeoutMs,
        // token 可选,带 token 提升限流额度
        ...(opts.githubToken ? { token: opts.githubToken } : {}),
      });

      // HuggingFace API 直接返回数组(非 { results: [...] } 结构)
      const models = Array.isArray(data) ? data : [];

      return models.map((m): HuggingfaceRawResult => ({
        source: 'huggingface',
        name: m.id,
        url: `https://huggingface.co/${m.id}`,
        // 描述:优先用 pipeline_tag + library_name 组合,没有就用 tags
        description: buildDescription(m),
        stars: m.likes ?? 0,
        downloads: m.downloads ?? 0,
        lastUpdated: m.lastModified ?? '',
        pipelineTag: m.pipeline_tag,
        libraryName: m.library_name,
      }));
    } catch (err) {
      if (err instanceof HttpError) throw new SourceError('huggingface', `HTTP ${err.status}`);
      throw new SourceError('huggingface', (err as Error).message);
    }
  }
}

/** 构造模型描述:pipeline_tag + library + tags 摘要 */
function buildDescription(m: HfModel): string {
  const parts: string[] = [];
  if (m.pipeline_tag) parts.push(m.pipeline_tag);
  if (m.library_name) parts.push(`(${m.library_name})`);
  // 防御:tags 可能不是数组(API 异常或字段类型变化)
  if (Array.isArray(m.tags) && m.tags.length > 0) {
    // 只取前 5 个 tag,避免描述过长
    const tagPreview = m.tags.slice(0, 5).join(', ');
    parts.push(`tags: ${tagPreview}`);
  }
  return parts.join(' ') || 'HuggingFace model';
}
