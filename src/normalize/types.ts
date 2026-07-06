// src/normalize/types.ts
// type-only import: 编译期擦除,不产生运行时循环依赖
// (wheelDetailsEnricher 反向 import type Wheel,同为 type-only,TS 能正确处理)
import type { WheelDetails } from '../enrich/wheelDetailsEnricher.js';

export type WheelSource = 'github' | 'gitlab' | 'gitee' | 'npm' | 'pypi' | 'crates' | 'librariesio' | 'web' | 'github-code' | 'vscode-marketplace' | 'paperswithcode' | 'huggingface' | 'maven' | 'rubygems' | 'gopkg';
export type WheelType = 'project' | 'package' | 'api' | 'cli' | 'sdk' | 'snippet' | 'extension' | 'paper' | 'model';
export type Activity = 'high' | 'medium' | 'low';

/** 推荐等级:从高到低 */
export type Recommendation =
  | 'highly_recommended' // 强烈推荐:高匹配 + 高 star + 活跃
  | 'recommended'        // 推荐:中等匹配或匹配但 star 一般
  | 'optional'           // 可选:低匹配或数据不足
  | 'not_recommended';   // 不推荐:虽未被过滤但匹配度很低

/** 查询相关的匹配信息,搜索结果里填充 */
export interface WheelMatch {
  /** 综合匹配分 0~1,结合相关度+热度+活跃度 (feedback 调整后的最终值) */
  score: number;
  /** 推荐等级 (基于 feedback 调整后的 score 重新分级) */
  recommendation: Recommendation;
  /** 推荐理由(中文简述),给 AI 总结时引用 */
  reason: string;
  /** 命中的 query 关键词列表 */
  matchedKeywords: string[];
  /** 反馈调整量(可选): 用户历史反馈(like/hide/click)带来的 score 增减, 正数=加分负数=扣分 */
  feedbackDelta?: number;
  /**
   * 召回解释(C 阶段):说明该 wheel 为什么被召回。
   * 形如 "命中核心词 stepper/motor;3.0k stars;近 1 年有更新"。
   * 帮助 AI 调用方快速判断相关性,减少误判。
   */
  recallReason?: string;
}

export interface WheelMetrics {
  stars?: number;
  lastUpdated?: string; // ISO date
  license?: string;
  archived?: boolean;
  downloads?: number;
  activity?: Activity;
}

export interface Wheel {
  name: string;
  source: WheelSource;
  url: string;
  description: string;
  type: WheelType;
  metrics: WheelMetrics;
  /**
   * 仓库/包的标签(GitHub topics / GitLab topics / npm keywords 等)。
   * 用于排序加分:topics 命中 query 关键词的项目更可能真正相关。
   * 缺失时为 undefined(部分源无 topics 字段)。
   */
  topics?: string[];
  /** 查询相关的匹配信息(可选,只在搜索结果里填充) */
  match?: WheelMatch;
  /** 详情(可选):仅 top N 结果内联填充,供 AI 直接展示 README 摘要/代码示例/release/license */
  details?: WheelDetails;
  /** 标记:表示该 wheel 的详情已预抓取并写入 details 缓存,AI 可调 get_wheel_details 懒加载 */
  hasDetails?: boolean;
}

export type Intent = 'feature' | 'project';

export interface FindWheelInput {
  query: string;
  intent?: 'feature' | 'project' | 'auto';
  ecosystem?: string;
  limit?: number;
  /**
   * AI 协作深化(C 阶段):要排除的 wheel name 列表(owner/repo 或包名)。
   * 场景:AI 上一轮看到结果后,识别出某些不相关或反向意图项目,
   * 调用 find_wheel(exclude: [...]) 重新搜索时跳过这些。
   * 注意:exclude 不触发新一次 API 调用,只在已召回的结果里过滤。
   * 若排除后结果不足,AI 应换 query 重新搜。
   */
  exclude?: string[];
}

export interface FindWheelOutput {
  query: string;
  intent: Intent;
  total: number;
  wheels: Wheel[];
  /**
   * 结构化概览:按推荐等级分组列出所有结果名。
   * 目的:让调用方 AI 看到明确的列表结构,倾向于列全所有结果而非只挑 1 个。
   */
  summary: {
    /** 给 AI 的展示指引 */
    instruction: string;
    /** 按推荐等级分组的结果名列表 */
    groups: Array<{
      level: Recommendation;
      /** 该等级的中文名 */
      label: string;
      /** 该等级的结果名列表 */
      items: string[];
    }>;
    /**
     * 低质量结果警告(可选)。当 top 1 结果 stars < 10 时触发,
     * 提示 AI 建议用户换更宽泛的 query 或使用 suggest_queries 工具。
     */
    warning?: string;
  };
  degradedSources?: string[];
  /** 命中缓存时为 true,提示调用方结果可能非实时 */
  cached?: boolean;
  /**
   * 被智能路由跳过的数据源名(可选)。
   * 当 query 强信号匹配某类(如 hardware/python/ui)时,findawheel 只搜选中源,
   * 跳过明显不相关的源以节省 API 配额。AI 可据此判断召回范围。
   * 召回不足(top 1 stars < 10 或结果 < 5 条)时会自动扩展到全源重搜,
   * 扩展后此字段为空(全部源都搜过了)。
   */
  skippedSources?: string[];
  /** 路由原因(可选),解释为什么跳过某些源。供 AI 调试和理解召回范围。 */
  routingReason?: string;
}

// Discriminated union of raw results per source
export interface GitHubRawResult {
  source: 'github';
  name: string;
  url: string;
  description: string;
  stars: number;
  language: string | null;
  license: string | null;
  archived: boolean;
  pushedAt: string;
  topics: string[];
}

export interface NpmRawResult {
  source: 'npm';
  name: string;
  url: string;
  description: string;
  version: string;
  keywords: string[];
  date: string; // last publish
  downloads?: number; // 周下载量(来自 npm downloads API)
  stars?: number; // GitHub stars(如果包关联了 GitHub 仓库)
  githubUrl?: string; // 关联的 GitHub 仓库地址
}

export interface CratesRawResult {
  source: 'crates';
  name: string;
  url: string;
  description: string;
  version: string;
  downloads: number;
  recentDownloads: number;
  updatedAt: string;
  license: string | null;
}

export interface GiteeRawResult {
  source: 'gitee';
  name: string;
  url: string;
  description: string;
  stars: number;
  language: string | null;
  license: string | null;
  updatedAt: string;
  /** Gitee 项目的人类可读名(可能和 path 不同,如 "vue-element-admin") */
  humanName?: string;
}

/** GitLab 项目原始结果(GitLab /api/v4/projects 搜索) */
export interface GitlabRawResult {
  source: 'gitlab';
  name: string;
  url: string;
  description: string;
  stars: number;
  /** 最近活动时间(对应 GitHub pushedAt) */
  lastActivityAt: string;
  topics: string[];
  archived: boolean;
}

/** PyPI 包原始结果(HTML 解析 pypi.org/search) */
export interface PypiRawResult {
  source: 'pypi';
  name: string;
  url: string;
  description: string;
  version: string;
  /** GitHub stars(如果包关联了 GitHub 仓库,enrich 阶段补充) */
  stars?: number;
  /** 关联的 GitHub 仓库地址(enrich 阶段从 home_page 提取) */
  githubUrl?: string;
}

/** Libraries.io 搜索结果(覆盖 30+ 包管理器) */
export interface LibrariesIoRawResult {
  source: 'librariesio';
  name: string;
  url: string;
  description: string;
  stars: number;
  language: string | null;
  /** 来源平台(npm/pypi/rubygems/cargo/maven...) */
  platform: string;
  /** 最近发布时间,可能为 null */
  lastUpdated: string | null;
}

/** Web 搜索结果(Tavily 等),网页/教程/工具站 */
export interface WebRawResult {
  source: 'web';
  /** 网页标题 */
  name: string;
  url: string;
  /** 网页内容摘要(Tavily 返回的 content) */
  description: string;
  /** Tavily 返回的相关度分数 0~1 */
  score?: number;
}

/** GitHub Code Search 结果(代码片段),对应 /search/code endpoint */
export interface GitHubCodeRawResult {
  source: 'github-code';
  /** 完整仓库名(owner/repo) */
  name: string;
  /** 文件在 GitHub 上的 html_url */
  url: string;
  /** 文件路径(如 src/utils/parser.ts) */
  path: string;
  /** 仓序述述(可能为空) */
  description: string;
  /** 仓库 stars */
  stars: number;
  /** 文件语言(如 TypeScript/Python) */
  language: string | null;
  /** 命中的代码片段(text_matches 里的 fragment,可能为空) */
  textFragment?: string;
  /** 仓库最近 push 时间 */
  pushedAt: string;
}

/** VS Code Marketplace 扩展结果 */
export interface VscodeExtensionRawResult {
  source: 'vscode-marketplace';
  /** 扩展 ID(publisher.name,如 ms-python.python) */
  name: string;
  /** 扩展详情页 URL */
  url: string;
  /** 扩展简介(displayName + shortDescription) */
  description: string;
  /** 安装数 */
  installCount: number;
  /** 评分(0~5) */
  averageRating?: number;
  /** 评分人数 */
  ratingCount?: number;
  /** 最近更新时间 */
  lastUpdated: string;
  /** publisher 名 */
  publisher: string;
}

/** Papers with Code 论文/算法结果 */
export interface PaperRawResult {
  source: 'paperswithcode';
  /** 论文标题 */
  name: string;
  /** 论文详情页 URL */
  url: string;
  /** 论文摘要 */
  description: string;
  /** 发表年份 */
  year?: number;
  /** 关联的 GitHub 仓库 URL 或 arxiv 链接(可能为空) */
  repoUrl?: string;
  /** 论文 stars(关联 repo 的,适配器暂未填充,留作未来扩展) */
  stars?: number;
}

/** HuggingFace Hub 模型结果(D 阶段新增,补 AI 模型盲区) */
export interface HuggingfaceRawResult {
  source: 'huggingface';
  /** 模型 ID(org/model-name 格式) */
  name: string;
  /** 模型详情页 URL */
  url: string;
  /** 描述(pipeline_tag + library + tags 摘要) */
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

/** Maven Central 包结果(Java/Kotlin 生态) */
export interface MavenRawResult {
  source: 'maven';
  /** 坐标(groupId:artifactId) */
  name: string;
  /** Maven Central 详情页 URL */
  url: string;
  /** 描述(从 pom 中提取,可能为空) */
  description: string;
  /** 最新版本 */
  version: string;
  /** 最后更新时间(ISO date,可能为空) */
  lastUpdated?: string;
  /** 仓库名(如 "central") */
  repository?: string;
}

/** RubyGems 包结果(Ruby 生态) */
export interface RubyGemsRawResult {
  source: 'rubygems';
  /** gem 名 */
  name: string;
  /** RubyGems 详情页 URL */
  url: string;
  /** 描述 */
  description: string;
  /** 最新版本 */
  version: string;
  /** 下载量 */
  downloads: number;
  /** 最近更新时间(ISO date) */
  updatedAt: string;
  /** 许可证 */
  license?: string;
  /** 关联的源码仓库 URL */
  sourceCodeUri?: string;
}

/** Go 模块结果(pkg.go.dev,HTML 解析) */
export interface GoModuleRawResult {
  source: 'gopkg';
  /** 模块路径(如 github.com/gin-gonic/gin) */
  name: string;
  /** pkg.go.dev 详情页 URL */
  url: string;
  /** 模块摘要(在 pkg.go.dev 搜索结果里显示) */
  description: string;
  /** 最新版本 */
  version: string;
  /** 最近发布时间(ISO date,可能为空) */
  publishedAt?: string;
}

export type RawResult = GitHubRawResult | NpmRawResult | CratesRawResult | GiteeRawResult | GitlabRawResult | PypiRawResult | LibrariesIoRawResult | WebRawResult | GitHubCodeRawResult | VscodeExtensionRawResult | PaperRawResult | HuggingfaceRawResult | MavenRawResult | RubyGemsRawResult | GoModuleRawResult;
