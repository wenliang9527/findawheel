<div align="center">

# ⚙️ findawheel 工作原理

### 内部架构 · 数据流 · 组件详解

[![Back to README](https://img.shields.io/badge/←-返回_README-blue.svg?style=flat-square)](../README.md)
[![Usage Guide](https://img.shields.io/badge/使用指南-USAGE-orange.svg?style=flat-square)](./USAGE.md)

</div>

---

## 📋 目录

| | 章节 | 内容 |
|:---:|:-----|:-----|
| 🏛️ | [整体架构](#-整体架构) | 系统全景图 |
| 🔄 | [核心数据流](#-核心数据流) | 7 步处理流程 |
| 🧩 | [组件详解](#-组件详解) | 7 个核心组件 |
| 📐 | [数据结构](#-数据结构) | 核心类型定义 |
| 📊 | [质量评估机制](#-质量评估机制) | 过滤与评分 |
| 🛡️ | [错误处理与降级](#-错误处理与降级) | 容错策略 |
| 📡 | [MCP 协议交互](#-mcp-协议交互) | 通信时序 |
| 🚧 | [YAGNI 边界](#-yagni-边界) | 一期不做的事 |

---

## 🏛️ 整体架构

findawheel 是一个基于 [MCP（Model Context Protocol）](https://modelcontextprotocol.io/) 的 stdio 服务。它对外暴露两个工具 `find_wheel` 和 `suggest_queries`，内部采用**适配器模式（Adapter Pattern）**组织数据源。

```
┌─────────────────────────────────────────────────────────────────┐
│                   AI 客户端（Trae / Cursor / Claude）             │
│                                                                 │
│   用户: "我想做一个 markdown 转 pdf 的工具"                       │
│                              │                                  │
│                              ▼                                  │
│   AI 先调 suggest_queries 生成搜索词 → 再调 find_wheel           │
└──────────────────────────────┬──────────────────────────────────┘
                               │ MCP stdio 协议
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      findawheel MCP 服务                         │
│                                                                 │
│   ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐       │
│   │  Server     │→ │ findWheelTool│→ │ QueryParser     │       │
│   │  (MCP 入口) │  │  (编排器)     │  │ +QueryClassifier│       │
│   └─────────────┘  └──────────────┘  └────────┬────────┘       │
│                                                 │               │
│              ┌──────────────────────────────────┘               │
│              ▼                                                  │
│   ┌──────────────────┐    ┌──────────────────┐                  │
│   │ 主搜索 (精准)     │    │ 副搜索 (同义词)   │                  │
│   └────────┬─────────┘    └────────┬─────────┘                  │
│            └──────────┬────────────┘                            │
│                       ▼                                         │
│   ┌──────────────────────────────────────────────────────┐      │
│   │  GitHub · Gitee · npm · crates.io · Web              │      │
│   │  (Web: Exa 主 + Tavily 兜底)                          │      │
│   └──────────────────────┬───────────────────────────────┘      │
│                          ▼                                      │
│                 ┌──────────────┐                                │
│                 │  Normalizer  │  ← 归一化为 Wheel               │
│                 └──────┬───────┘                                │
│                        ▼                                        │
│                 ┌──────────────┐                                │
│                 │MetricsEnricher│ ← 指标 + 活跃度                │
│                 └──────┬───────┘                                │
│                        ▼                                        │
│                 ┌──────────────┐                                │
│                 │ Recommender  │  ← 推荐等级 + 理由              │
│                 └──────┬───────┘                                │
│                        ▼                                        │
│                 ┌──────────────┐                                │
│                 │    Ranker    │  ← 多重过滤 + 评分 + 去重 + 排序 │
│                 └──────┬───────┘                                │
│                        ▼                                        │
│                 Wheel[] + summary 返回                          │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                AI 客户端按推荐等级分组展示给用户                    │
│                                                                 │
│   AI: 我找到了这些轮子，按推荐等级分组：                            │
│        🟢 强烈推荐: markdown-pdf (18k stars, MIT)                │
│        🔵 推荐:     md-to-pdf (8k stars) ...                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔄 核心数据流

一次 `find_wheel` 调用的完整流程：

### 步骤 1️⃣ 接收请求

AI 客户端通过 MCP 协议发送 `tools/call` 请求：

```json
{
  "method": "tools/call",
  "params": {
    "name": "find_wheel",
    "arguments": {
      "query": "markdown to pdf",
      "intent": "auto",
      "limit": 10
    }
  }
}
```

`server.ts` 接收请求，用 zod 校验参数后转交给 `findWheelTool`。

### 步骤 2️⃣ 查询解析 + 意图分类

`QueryParser` 先对 query 做结构化拆解，`QueryClassifier` 再判断意图。

**QueryParser 输出**：

| 字段 | 含义 | 用途 |
|:-----|:-----|:-----|
| `coreWords` | 核心动词/名词（优先动词） | GitHub 引号短语强制命中 + Ranker 核心词必命中检查 |
| `modifierWords` | 修饰词 | 加权匹配 |
| `antonymWords` | 反向意图词（如"remove"/"delete"） | GitHub `NOT` 排除 |
| `formatWords` | 格式词（pdf/word/ppt/excel/docx/html/markdown/json） | AND 必命中过滤 |
| `expandedQuery` | 翻译+同义词扩展后的英文 query | 传给所有适配器 |
| `fuzzyQuery` | 同义词泛化后的副搜索 query | 用于副搜索 |

**QueryClassifier 判断意图**：

| 意图 | 含义 | 影响 |
|:-----|:-----|:-----|
| `feature` | 查找一个具体功能/能力（如"图片压缩"） | 优先查 npm/crates，GitHub 搜索加 `in:readme`，排序侧重下载量 |
| `project` | 查找一个完整项目（如"笔记应用"） | 优先查 GitHub，排序侧重 stars |

**分类方式**：关键词启发式（非 LLM）。检查 query 中是否包含预设的信号词：

- **project 信号词**：`app`、`editor`、`dashboard`、`应用`、`平台`...
- **feature 信号词**：`parse`、`convert`、`compress`、`解析`、`转换`...

信号词多的一方胜出；打平或都没命中时默认 `project`（更安全的回退）。

> 💡 **中文翻译**：QueryParser 内部调用 `queryTranslator`，内置 50+ 词的中英技术术语映射表（如"图片"→"image"、"水印"→"watermark"），中文 query 会被翻译成英文后再拆解。

### 步骤 3️⃣ 主搜索 + 副搜索并行

findWheelTool 同时发起两组搜索：

```
主搜索 (precise):  用 expandedQuery 调所有适配器
副搜索 (fuzzy):    用 fuzzyQuery（同义词泛化）调所有适配器
```

两组搜索并行执行，结果合并后去重。这能扩大召回——比如搜"monitor"时副搜索会用"observer/watcher"找到主搜索漏掉的项目。

**每个适配器内部**也是并行调用各自的子源：

```
GitHubSourceAdapter.search()     ← GitHub Search API（引号短语 + NOT 排除）
GiteeSourceAdapter.search()      ← Gitee OpenAPI
RegistrySourceAdapter.search()   ← npm + crates.io API（内部也并行）
WebSourceAdapter.search()        ← Exa 主，失败 fallback Tavily
```

每个适配器返回各自格式的 `RawResult[]`。使用 `Promise.allSettled` 聚合——任一源失败不影响其他源。

### 步骤 4️⃣ 归一化

`Normalizer` 把不同源的 `RawResult` 转成统一的 `Wheel` 结构：

| 源 | 原始字段 | 归一化后 |
|:----|:----------|:----------|
| GitHub | `stargazers_count`、`pushed_at`、`license.spdx_id` | `metrics.stars`、`lastUpdated`、`license` |
| Gitee | `stargazers_count`、`updated_at`、`license.name` | `metrics.stars`、`lastUpdated`、`license` |
| npm | `date`（最近发布）、`keywords` | `metrics.lastUpdated`、推断 type |
| crates | `downloads`、`updated_at` | `metrics.downloads`、`lastUpdated` |
| Web | `score`（Exa/Tavily 返回） | `metrics` 留空，type 推断为 `project` |

**`type` 字段推断规则**：
- GitHub/Gitee 仓库：默认 `project`，若 `topics` 含 `cli`/`sdk`/`api` 则覆盖
- npm/crates 包：一律 `package`
- Web 结果：一律 `project`（无法区分，按项目处理）

### 步骤 5️⃣ 指标补充

`MetricsEnricher` 补充 `activity`（活跃度）字段：

| 条件 | activity |
|:-----|:---------|
| `lastUpdated` 在 6 个月内 | `high` |
| `lastUpdated` 在 2 年内 | `medium` |
| 更旧或缺失 | `low` |

### 步骤 6️⃣ 推荐等级 + 过滤 + 评分 + 去重

`Recommender` 先为每个 wheel 计算推荐等级，`Ranker` 再执行过滤、评分、去重。

**6.0 推荐等级计算**（Recommender）：

基于 stars、活跃度、描述命中数等综合计算 `matchScore`，映射到四个等级：

| 等级 | matchScore | 含义 |
|:-----|:-----|:-----|
| `highly_recommended` | ≥ 0.7 | 强烈推荐，命中药准、质量高 |
| `recommended` | ≥ 0.4 | 推荐，相关但稍弱 |
| `optional` | ≥ 0.2 | 可选，仅供参考 |
| `not_recommended` | < 0.2 | 不推荐，相关性低 |

同时生成 `reason`（中文理由）和 `matchedKeywords`（命中的查询词）。

**6.1 硬过滤**（直接剔除）：
- `archived === true`（GitHub 归档仓库）
- `lastUpdated` 距今 > 3 年（明显废弃）
- `description` 为空且 `stars < 10`（信息不足）
- **聚合仓库检测**：name/description 含 `awesome`/`curated`/`collection`/`list` 等关键词
- **反向意图过滤**：query 含反义词（如"remove"），结果命中反向词（如"remover"）但不命中核心词
- **核心词缺失过滤**：name + description 不包含任何 `coreWords`
- **格式词缺失过滤**：query 含格式词（如"pdf"），但 name + description 不命中任何格式词

**6.2 去重**：
- 按 `name`（小写）合并
- 保留指标字段更多的那条（如 `lodash` 同时出现在 npm 和 GitHub，保留 GitHub 版本因为多了 `stars`）

**6.3 评分排序**：

每个 wheel 计算一个综合分（0~1）：

```
score = stars权重     × 0.3      ← 归一化到 [0, 50000]
      + recency权重   × 0.3      ← 1年内=1.0, 1-2年=0.7, 2-3年=0.4
      + activity权重  × 0.2      ← high=1.0, medium=0.5, low=0.2
      + downloads权重 × 0.1      ← 归一化到 [0, 100000]
      + license权重   × 0.1      ← 有 license = 1.0，无 = 0
      + queryCoverage × 0.2      ← 描述命中所有 query 内容词得 0.2，部分命中按比例
```

**额外调整**：
- **高 star 零命中降权**：stars 高但 query 关键词一个都没命中，`stars` 权重 ×0.7
- **意图调整**：当 `intent=feature` 时，`stars` 权重 ×0.7、`downloads` 权重 ×1.5

按分数降序排列，截取 `limit` 条。

### 步骤 7️⃣ 返回结果

构造响应 JSON 并通过 MCP 协议返回给 AI。顶部是 `summary` 引导段（让 AI 一眼看到所有结果按推荐等级分组），下方是详细的 `wheels` 数组：

```json
{
  "summary": {
    "total": 60,
    "highly_recommended": ["owner/markdown-pdf", "owner/md-to-pdf"],
    "recommended": ["owner/markdown-pdfify"],
    "optional": [],
    "not_recommended": []
  },
  "query": "markdown to pdf",
  "intent": "feature",
  "total": 60,
  "wheels": [
    {
      "name": "owner/markdown-pdf",
      "source": "github",
      "url": "https://github.com/owner/markdown-pdf",
      "description": "...",
      "type": "project",
      "metrics": { "stars": 18000, "license": "MIT", "activity": "high" },
      "match": {
        "score": 0.88,
        "recommendation": "highly_recommended",
        "reason": "命中核心词 markdown/pdf，stars 高，活跃维护",
        "matchedKeywords": ["markdown", "pdf"]
      }
    }
  ],
  "degradedSources": ["crates"]
}
```

> ℹ️ `degradedSources` 字段仅在某个源失败时才出现。
> 💡 `summary` 段是引导 AI **分组列出所有结果**的关键设计，避免 AI 只挑一条展示。

AI 拿到结构化数据后，按 `summary` 中的推荐等级分组用自然语言推荐给用户。

---

## 🧩 组件详解

### 1. Server（MCP 入口）

| | |
|:---|:---|
| 📄 **文件** | `src/server.ts` |

**职责**：
- 创建 MCP `Server` 实例，声明 `tools` 能力
- 注册 `find_wheel` 工具的元信息（名称、描述、输入 schema）
- 处理 `tools/list` 请求（返回工具列表）
- 处理 `tools/call` 请求（用 zod 校验参数后转交 `findWheelTool`）
- 启动 stdio 传输层

**关键代码逻辑**：

```typescript
const server = new Server(
  { name: 'findawheel', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, ...);   // 返回工具列表
server.setRequestHandler(CallToolRequestSchema, ...);    // 处理工具调用
```

---

### 2. findWheelTool（编排器）

| | |
|:---|:---|
| 📄 **文件** | `src/tools/findWheelTool.ts` |

**职责**：编排整个查询流程，是核心协调者。

**工作流**：

```
1. 校验 query 非空
       ↓
2. 调用 QueryParser.parse() 拆解核心词/修饰词/反义词/格式词/同义词
       ↓
3. 调用 QueryClassifier.classify() 判断 feature/project
       ↓
4. 并行发起主搜索 + 副搜索（同义词泛化）
   每组用 Promise.allSettled 并行调所有适配器
       ↓
5. 收集成功结果 + 记录失败源到 degradedSources
       ↓
6. 判定 allFailed（所有源都 rejected 才算）
       ↓
7. 串联 normalize → enrich → recommend → rank
       ↓
8. 构造 summary（按推荐等级分组）+ 返回结构化结果
```

**降级逻辑**：
- 任一源失败：跳过该源，其他源正常返回，结果附 `degradedSources` 字段
- 全部源失败：返回 `isError: true`
- 全部源返回 0 结果：正常返回空 `wheels: []`，不算错

---

### 3. QueryClassifier（意图分类器）

| | |
|:---|:---|
| 📄 **文件** | `src/classifier/queryClassifier.ts` |

**职责**：判断 query 是 `feature` 还是 `project`。

**实现**：纯函数式关键词启发式，无状态、无副作用、不上 LLM。

```typescript
function classify(query, hint?): 'feature' | 'project'
```

> 💡 **为什么不用 LLM 分类**
>
> - 关键词启发式足够快（微秒级），无需额外 API 调用
> - MVP 阶段的 query 模式相对简单
> - 二期可考虑接入 LLM 提升准确率（见路线图）

---

### 3.5. QueryParser（查询解析器）

| | |
|:---|:---|
| 📄 **文件** | `src/classifier/queryParser.ts` |
| 🌐 **辅助** | `src/classifier/queryTranslator.ts`（中英翻译表） |

**职责**：把自然语言 query 拆解成结构化的 `ParsedQuery`，供后续过滤、评分、搜索语法构造使用。

**输出字段**：

| 字段 | 含义 | 用途 |
|:-----|:-----|:-----|
| `coreWords` | 核心词（优先动词，如 compress/parse） | GitHub 引号短语强制命中；Ranker 核心词必命中检查 |
| `modifierWords` | 修饰词（如 cli/high-performance） | 加权匹配 |
| `antonymWords` | 反向意图词（如 remove/delete） | GitHub `NOT` 排除 |
| `formatWords` | 格式词（pdf/word/excel 等 30+） | AND 必命中过滤 |
| `expandedQuery` | 翻译+扩展后的英文 query | 传给所有适配器 |
| `fuzzyQuery` | 同义词泛化后的副搜索 query | 副搜索用 |

**动词优先策略**：核心词选择时优先从动词中取（动词通常表达核心意图），而非简单取前 2 个内容词。

**同义词表**：内置 monitor→observer/watcher、compress→shrink/optimize 等映射，用于副搜索扩大召回。

> 💡 **中文翻译**：`queryTranslator` 内置 50+ 词中英技术术语映射（如"图片"→"image"、"水印"→"watermark"、"解析"→"parse"），中文 query 会被翻译成英文后再拆解。

---

### 4. SourceAdapter（数据源适配器）

| | |
|:---|:---|
| 📄 **接口文件** | `src/sources/sourceAdapter.ts` |

```typescript
interface SourceAdapter {
  readonly name: string;
  search(query: string, opts: SearchOpts): Promise<RawResult[]>;
}
```

> 💡 这是**适配器模式**的抽象——所有数据源实现同一接口，主流程不关心具体源的差异。
> 二期加 Web 搜索源只需新增一个 adapter，不动其他代码。

#### 4.1 GitHubSourceAdapter

| | |
|:---|:---|
| 📄 **文件** | `src/sources/githubSourceAdapter.ts` |
| 🌐 **API** | `GET https://api.github.com/search/repositories` |

**搜索语法构造**：
- 把自然语言 query 转成 GitHub 搜索表达式
- `intent=project` → `query in:name,description sort:stars`
- `intent=feature` → `query in:name,description,readme sort:stars`
- `ecosystem=js` → 追加 `language:JavaScript`
- **核心词引号强制命中**：coreWords 用 `"word"` 包起来，要求 GitHub 必须命中
- **反义词 NOT 排除**：antonymWords 用 `NOT word` 排除（如搜"水印"排除"remover"）
- **聚合仓库排除**：自动追加 `NOT awesome in:name`
- `per_page` 设为 50（默认 20）

**鉴权**：可选 `GITHUB_TOKEN`。无 token 限流 60 次/小时，有 token 5000 次/小时。

**限流处理**：
- 解析响应头 `X-RateLimit-Remaining`
- 403 + `X-RateLimit-Remaining: 0` → 抛 `RateLimitError`
- 由主流程降级处理

#### 4.2 RegistrySourceAdapter

| | |
|:---|:---|
| 📄 **文件** | `src/sources/registrySourceAdapter.ts` |

聚合两个子源：

| 子源 | API | 特点 |
|:-----|:-----|:-----|
| npm | `https://registry.npmjs.org/-/v1/search` | 公开，无需 token；不返回下载量 |
| crates.io | `https://crates.io/api/v1/crates` | 公开；返回 downloads 和 recent_downloads，指标最全 |

> ℹ️ **PyPI 策略**：PyPI 没有官方搜索 JSON API。Phase 3.1 起通过解析 `pypi.org/search` 的 HTML 提取包信息（无 stars/downloads），解析失败返回空数组不阻断。

**npm 包指标补充**：npm registry 不返回 stars 和 downloads，适配器会并发调用 GitHub API（按包名查仓库 stars）和 npm downloads API（查周下载量）补充，让 npm 包和 GitHub 仓库能公平排序。

**内部聚合**：用 `Promise.allSettled` 并行查 npm 和 crates，**仅当所有子源都失败时才抛错**；任一子源有结果就正常返回。

#### 4.3 GiteeSourceAdapter

| | |
|:---|:---|
| 📄 **文件** | `src/sources/giteeSourceAdapter.ts` |
| 🌐 **API** | `GET https://gitee.com/api/v5/search/repositories` |

**用途**：补充国内开源项目覆盖，访问速度快。

**特点**：
- 无需 token，公开 API
- 支持 `sort=stars`、`order=desc`、`per_page=20`
- 支持 `language` 参数按语言过滤（`ecosystem` 映射到 `JavaScript`/`TypeScript` 等）
- **不支持** GitHub 的引号短语和 `NOT` 语法，查询精度略低
- 用 `translateQuery` 把中文 query 翻译成英文后搜索（部分国内项目用英文命名）

**限流处理**：403 抛 `RateLimitError`，其他 HTTP 错误抛 `SourceError`。

#### 4.4 GitlabSourceAdapter

| | |
|:---|:---|
| 📄 **文件** | `src/sources/gitlabSourceAdapter.ts` |

- API: `GET https://gitlab.com/api/v4/projects?search=<q>&order_by=star_count&sort=desc&per_page=50`
- 不支持 NOT/引号语法，直接用翻译后的 query
- 鉴权：可选 `GITLAB_TOKEN`（用 `PRIVATE-TOKEN` header，匿名可搜）
- 429 → 抛 `RateLimitError`
- 字段映射：`path_with_namespace`→name, `web_url`→url, `star_count`→stars, `last_activity_at`→lastUpdated

#### 4.5 PypiSourceAdapter

| | |
|:---|:---|
| 📄 **文件** | `src/sources/pypiSourceAdapter.ts` |

- API: 解析 `https://pypi.org/search/?q=<q>` 的 HTML
- 无官方搜索 JSON API，用正则提取 `package-snippet` 块
- 无 stars/downloads 数据
- 解析失败返回空数组（容错，HTML 结构变更不阻断）
- 字段映射：包名、描述、链接、版本号

#### 4.6 LibrariesIoSourceAdapter

| | |
|:---|:---|
| 📄 **文件** | `src/sources/librariesIoSourceAdapter.ts` |

- API: `GET https://libraries.io/api/search?q=<q>&api_key=<key>`
- 一次查询覆盖 30+ 包管理器（npm/pypi/rubygems/cargo/maven...）
- 鉴权：必需 `LIBRARIES_IO_API_KEY`，未配置时返回空数组跳过（零配置兼容）
- URL fallback：homepage → repository_url → `https://libraries.io/{platform}/{name}`
- 字段映射：name/description/stars/language/platform/lastUpdated

#### 4.7 WebSourceAdapter（Exa 主 + Tavily 兜底）

| | |
|:---|:---|
| 📄 **文件** | `src/sources/webSourceAdapter.ts` |
| 🌐 **Exa API** | `POST https://api.exa.ai/search` |
| 🌐 **Tavily API** | `POST https://api.tavily.com/search` |

**用途**：网页搜索，覆盖 GitHub/npm/crates 之外的教程站、工具站、博客。

**双源 fallback 策略**：

```
1. 优先调 Exa（神经网络搜索，对代码语义友好）
2. Exa 失败时判断：
   - 402（额度耗尽）/ 429（限流）/ 网络错误 → fallback 到 Tavily
   - 401/403（key 无效）/ 其他 4xx → 不 fallback（避免无意义请求）
3. Tavily 失败 → 返回空数组（不影响其他源）
```

**Exa 请求**：
- Header: `x-api-key`
- Body: `{ query, numResults: 10, contents: { text: true, highlights: true } }`
- 返回 title/url/highlights/text/score

**Tavily 请求**：
- Body: `{ api_key, query, search_depth: 'basic', max_results: 10, include_domains: [github.com, npmjs.com, crates.io, pypi.org] }`
- 限定域名到主流代码托管和包管理站点，避免无关结果

> 💡 **零配置兼容**：两个 key 都未配置时，WebSourceAdapter 直接返回空数组，findawheel 仍可正常使用其他四个源。

---

### 5. Normalizer（归一化器）

| | |
|:---|:---|
| 📄 **文件** | `src/normalize/normalizer.ts` |

**职责**：把不同格式的 `RawResult` 映射成统一的 `Wheel`。

> 💡 这是**多源聚合的关键**——不同源的 API 返回字段千差万别，必须先归一化才能统一排序。

**类型推断**：

| 输入 | type |
|:-----|:-----|
| GitHub 仓库 + topics 含 `cli` | `cli` |
| GitHub 仓库 + topics 含 `sdk` | `sdk` |
| GitHub 仓库 + topics 含 `api` | `api` |
| GitHub 仓库无特殊 topics | `project` |
| npm/crates 包 | `package` |

**字段对齐**：

| 字段 | GitHub | npm | crates |
|:-----|:-------|:----|:-------|
| `lastUpdated` | `pushed_at` | `date` | `updated_at` |
| `stars` | ✅ | — | — |
| `downloads` | — | — | ✅ |
| `license` | `license.spdx_id` | （一期留空） | `license` |

---

### 6. MetricsEnricher（指标补充器）

| | |
|:---|:---|
| 📄 **文件** | `src/enrich/metricsEnricher.ts` |

**职责**：基于已有指标推断 `activity`（活跃度），便于后续排序。

> 💡 **为什么不直接用 `lastUpdated` 排序**
>
> - `lastUpdated` 是绝对时间，不同源的含义不同（GitHub 是代码推送，npm 是包发布）
> - `activity` 是相对分级，更稳定、更可比

---

### 7. Ranker（排序器）

| | |
|:---|:---|
| 📄 **文件** | `src/rank/ranker.ts` |

导出 4 个函数：

| 函数 | 职责 |
|:-----|:-----|
| `filterOut(wheel, opts)` | 硬过滤判定，返回 true 表示剔除；opts 含 coreWords/antonymWords/formatWords 用于核心词/反向意图/格式词检查 |
| `score(wheel, intent, opts)` | 计算综合分（0~1），含 queryCoverage 和高 star 零命中降权 |
| `dedupe(wheels)` | 按 name 去重，保留指标更全的 |
| `rank(wheels, intent, limit, parsedQuery)` | 串联上述三步，返回最终结果；parsedQuery 提供核心词/格式词/反义词 |

**额外过滤函数**：
- `isAggregateRepo(wheel)` — 检测 awesome/curated/collection/list 聚合仓库
- `isMissingCoreConcept(wheel, coreWords)` — 核心词缺失检查
- `isZeroHit(wheel, queryWords)` — 零命中检测（用于高 star 零命中降权）

---

### 8. Recommender（推荐器）

| | |
|:---|:---|
| 📄 **文件** | `src/rank/recommender.ts` |

**职责**：为每个 wheel 计算推荐等级和理由，填充 `match` 字段。

**输入**：wheel + parsedQuery

**输出**：`WheelMatch`（score / recommendation / reason / matchedKeywords）

**计算逻辑**：
1. 统计 name + description 命中的查询词数（核心词权重高）
2. 综合 stars、活跃度、命中数计算 `matchScore`（0~1）
3. 按阈值映射到四个推荐等级
4. 生成中文 `reason`（如"命中核心词 markdown/pdf，stars 高，活跃维护"）
5. 收集 `matchedKeywords` 列表

> 💡 Recommender 在 Ranker **之前**运行——先填好 `match` 字段，Ranker 的过滤和评分才能引用 match 信息。

---

## 📐 数据结构

### Wheel（统一轮子结构）

> 📌 这是整个系统的核心数据模型，所有源的原始数据最终都归一化成这个结构。

```typescript
interface Wheel {
  name: string;            // 仓库名 / 包名 / 服务名
  source: 'github' | 'gitee' | 'npm' | 'pypi' | 'crates' | 'web';
  url: string;             // 主页/仓库链接
  description: string;     // 简短描述
  type: 'project' | 'package' | 'api' | 'cli' | 'sdk';
  metrics: {
    stars?: number;        // GitHub / Gitee
    lastUpdated?: string;  // ISO 日期
    license?: string;      // SPDX ID，如 'MIT'
    archived?: boolean;    // 仅 GitHub
    downloads?: number;    // crates + npm（补充后）
    activity?: 'high' | 'medium' | 'low';  // 由 MetricsEnricher 推断
  };
  match?: WheelMatch;      // 由 Recommender 填充
}

interface WheelMatch {
  score: number;                  // 0~1，匹配度
  recommendation: 'highly_recommended' | 'recommended' | 'optional' | 'not_recommended';
  reason: string;                 // 中文推荐理由
  matchedKeywords: string[];      // 命中的查询词
}
```

### RawResult（各源原始结果）

判别联合类型，每个源有自己的字段：

```typescript
type RawResult = GitHubRawResult | GiteeRawResult | NpmRawResult | CratesRawResult | WebRawResult;
```

> 💡 `source` 字段作为判别标签，Normalizer 用 `switch (raw.source)` 分发处理。

### FindWheelInput / FindWheelOutput

工具的输入输出契约：

```typescript
interface FindWheelInput {
  query: string;
  intent?: 'feature' | 'project' | 'auto';
  ecosystem?: string;
  limit?: number;
}

interface FindWheelOutput {
  summary: {                        // 引导 AI 分组列出所有结果
    total: number;
    highly_recommended: string[];   // 结果名列表
    recommended: string[];
    optional: string[];
    not_recommended: string[];
  };
  query: string;
  intent: Intent;          // 实际使用的意图（已分类）
  total: number;           // 原始命中数（去重前）
  wheels: Wheel[];         // 排序后的结果（每个带 match 字段）
  degradedSources?: string[];  // 失败的源（仅有降级时出现）
}
```

### suggest_queries 工具

除了 `find_wheel`，findawheel 还注册了 `suggest_queries` 工具，用于 AI 不确定怎么构造搜索词时生成建议。

**输入**：`query`（用户原始描述）

**输出**：4 个角度的搜索词变体 + 推荐选项

```typescript
interface SuggestQueriesOutput {
  variants: {
    precise: string;        // 精准版，保留原意
    action_oriented: string;// 动作导向，突出动词
    fuzzy: string;          // 模糊版，同义词泛化
    concise: string;        // 简洁版，去修饰词
  };
  recommended: 'precise' | 'action_oriented' | 'fuzzy' | 'concise';
}
```

> 💡 AI 应在用户表达模糊需求时先调 `suggest_queries`，选最合适的变体再调 `find_wheel`。

---

## 📊 质量评估机制

### 过滤规则（硬过滤）

以下情况直接剔除，不参与排序：

| 规则 | 原因 |
|:-----|:-----|
| `archived === true` | GitHub 归档仓库，已停止维护 |
| `lastUpdated` 距今 > 3 年 | 明显废弃 |
| `description` 为空 且 `stars < 10` | 信息不足，难以判断质量 |
| name/description 含 `awesome`/`curated`/`collection`/`list` | 聚合仓库，不是具体工具 |
| 命中反向词但不命中核心词 | 反向意图（如搜"水印"出现"水印 remover"） |
| name + description 不包含任何 `coreWords` | 核心词缺失，相关性低 |
| query 含格式词但结果不命中任何格式词 | 格式词必命中（AND 检查） |

### 评分公式

综合分 = 加权求和，归一化到 [0, 1]：

```
score = 0.3 × normalize(stars, 50000)
      + 0.3 × recencyScore(lastUpdated)
      + 0.2 × activityScore(activity)
      + 0.1 × normalize(downloads, 100000)
      + 0.1 × hasLicense(license)
      + 0.2 × queryCoverage(description, queryContentWords)
```

**各子分计算**：

| 子分 | 计算方式 |
|:-----|:---------|
| `stars` | `min(stars / 50000, 1)` — 5 万 stars 满分 |
| `recency` | 1 年内 = 1.0；1-2 年 = 0.7；2-3 年 = 0.4；更旧 = 0 |
| `activity` | high = 1.0；medium = 0.5；low = 0.2 |
| `downloads` | `min(downloads / 100000, 1)` — 10 万下载满分 |
| `license` | 有 = 1.0；无 = 0 |
| `queryCoverage` | 描述命中所有 query 内容词 = 0.2；部分命中按比例；都不命中 = 0 |

**额外调整**：

| 调整 | 触发条件 | 效果 |
|:-----|:-----|:-----|
| 高 star 零命中降权 | stars 高但 query 关键词一个都没命中 | `stars` 权重 ×0.7 |
| 意图调整（feature） | `intent=feature` | `stars` ×0.7、`downloads` ×1.5 |
| 意图调整（project） | `intent=project` | 默认权重 |

### 推荐等级映射

`Recommender` 基于综合 score 和匹配情况映射推荐等级：

| 等级 | score 阈值 | 含义 |
|:-----|:-----|:-----|
| `highly_recommended` | ≥ 0.7 | 命中精准、质量高、活跃维护 |
| `recommended` | ≥ 0.4 | 相关但稍弱 |
| `optional` | ≥ 0.2 | 仅供参考 |
| `not_recommended` | < 0.2 | 相关性低 |

### 权重设计思路

| 指标 | 权重 | 为什么 |
|:-----|:----:|:-------|
| stars + recency | 各 0.3（共 0.6） | 社区认可度和维护活跃度是质量的最强信号 |
| activity | 0.2 | 区分"近期还活着"和"只是没归档" |
| downloads | 0.1 | crates + npm（补充后）有，权重低避免偏袒包源 |
| license | 0.1 | 有 license 是基本要求，但不强求特定协议 |
| queryCoverage | 0.2 | 描述命中查询词是最直接的相关性信号 |

> ⚠️ **MVP 声明**：评分公式为启发式权重，未做机器学习/调参。能跑出"明显的垃圾在后、明显的好货在前"就达标。精确排序是三期增强项。

---

## 🛡️ 错误处理与降级

### 设计原则

> 🎯 **部分成功优于全失败**——任一数据源失败不应阻断整个查询。

### 错误类型

```typescript
class SourceError extends Error {
  source: string;    // 哪个源出错
}

class RateLimitError extends SourceError {
  resetAt: Date;     // 限流何时重置
}
```

### 降级矩阵

| 场景 | 行为 | HTTP 状态 |
|:-----|:-----|:----------|
| 单个适配器抛错 | 跳过该源，其他源正常返回，附 `degradedSources` | 200 |
| 所有适配器全失败 | 返回 `isError: true`，说明"所有数据源暂不可用" | 200 + isError |
| `query` 为空 | 返回 `isError: true`，提示必填 | 200 + isError |
| 单源返回 0 结果 | 不算错，正常聚合 | 200 |
| 全部源 0 结果 | 正常返回空 `wheels: []` | 200 |
| **Exa 失败（402/429/网络）** | **自动 fallback 到 Tavily**（若配置了 key） | 200 |
| **Exa 失败（401/403 key 无效）** | **不 fallback**，WebSourceAdapter 返回空数组 | 200 |
| **Tavily 也失败** | WebSourceAdapter 返回空数组，不影响其他源 | 200 |

### 不重试策略

> ⚠️ 一期**不实现自动重试**：
>
> - 避免雪崩效应（限流时重试会加重负担）
> - 简化实现
> - 二期可加指数退避重试（见路线图）

---

## 📡 MCP 协议交互

findawheel 是 **stdio 类型**的 MCP 服务，通过标准输入输出与 AI 客户端通信。

### 通信流程

```
AI 客户端                              findawheel
   │                                       │
   │──── initialize ─────────────────────→│
   │←── serverInfo (findawheel) ──────────│
   │                                       │
   │──── notifications/initialized ──────→│
   │                                       │
   │──── tools/list ─────────────────────→│
   │←── [{name: "find_wheel", ...},       │
   │     {name: "suggest_queries", ...}]──│
   │                                       │
   │──── tools/call (suggest_queries) ───→│  ← 可选：不确定搜索词时
   │←── {variants: {...}, recommended} ──│
   │                                       │
   │──── tools/call (find_wheel) ────────→│
   │                                       │
   │       （findawheel 内部处理：          │
   │        解析 → 主搜索+副搜索 → 归一化 → │
   │        补充 → 推荐 → 过滤排序）         │
   │                                       │
   │←── {content: [{text: JSON}]} ────────│
   │       （含 summary + wheels + match） │
   │                                       │
```

### 工具注册信息

findawheel 注册了两个工具：

**find_wheel**（主工具）：

```json
{
  "name": "find_wheel",
  "description": "Search for existing reusable wheels (open-source projects, npm/crates packages, APIs, CLI, SDK). MUST CALL THIS FIRST before any creative work (brainstorming/designing/planning/coding) when user says 'I want to make/build/create a ...'. Returns results grouped by recommendation level (highly_recommended/recommended/optional/not_recommended).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {"type": "string"},
      "intent": {"type": "string", "enum": ["feature", "project", "auto"]},
      "ecosystem": {"type": "string"},
      "limit": {"type": "number"}
    },
    "required": ["query"]
  }
}
```

**suggest_queries**（辅助工具）：

```json
{
  "name": "suggest_queries",
  "description": "Generate 4 search-term variants (precise/action_oriented/fuzzy/concise) for a user's idea. Call this before find_wheel when unsure how to construct the query.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {"type": "string"}
    },
    "required": ["query"]
  }
}
```

### 关键设计：工具只给数据，不写文案

> 🎯 `find_wheel` 返回**结构化 JSON**，不返回自然语言推荐文案。

**为什么**：
- MCP 工具的职责是拿数据，调用方 AI 的职责是理解和呈现
- AI 能结合对话上下文做更精准的推荐（知道用户在做什么项目、用什么技术栈）
- 避免工具和 AI 重复生成文案

---

## 🚧 YAGNI 边界

以下功能**明确不在当前范围**，避免过度设计：

| ❌ 不做 | 原因 |
|:------|:-----|
| PyPI 独立搜索源 | 无官方 API，由 GitHub + Web 兜底 |
| README / 示例代码抓取 | 信息密度低、抓取复杂 |
| 结果缓存 | 当前流量低，实时查够用 |
| 自动重试 | 避免雪崩，简化实现 |
| 多用户、鉴权、服务端托管 | 超出 MCP 服务定位 |
| 社区评论、收藏夹、Web UI | 非核心功能 |
| ML 评分调参 | 启发式权重已够用，精确排序是三期项 |

> ✅ **二期已完成**：npm 下载量补充、Web 搜索源（Exa+Tavily）、Gitee 源、推荐等级系统、suggest_queries 工具、同义词副搜索、中文翻译表、核心词引号命中、反义词 NOT 排除。

这些会在三期按需加入，见 [README 路线图](../README.md#-路线图)。

---

<div align="center">

## 📚 进一步阅读

| | 文档 | 描述 |
|:---:|:-----|:-----|
| 🏠 | [README](../README.md) | 项目总览 |
| 📖 | [使用指南](./USAGE.md) | 下载、安装、配置、使用 |
| 📐 | [设计规格](./superpowers/specs/2026-07-02-findawheel-design.md) | 完整设计决策记录 |
| 📝 | [实现计划](./superpowers/plans/2026-07-02-findawheel.md) | 16 个任务的 TDD 步骤 |
| 🌐 | [MCP 协议官网](https://modelcontextprotocol.io/) | 理解 MCP 协议本身 |

</div>

---

<div align="center">

<sub>本文档由 findawheel 项目维护</sub>

**[↑ 返回顶部](#️-findawheel-工作原理)**

</div>
