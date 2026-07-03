# findawheel 工作原理

本文档详细解释 findawheel 的内部架构、数据流和各组件工作原理。

---

## 目录

- [整体架构](#整体架构)
- [核心数据流](#核心数据流)
- [组件详解](#组件详解)
- [数据结构](#数据结构)
- [质量评估机制](#质量评估机制)
- [错误处理与降级](#错误处理与降级)
- [MCP 协议交互](#mcp-协议交互)

---

## 整体架构

findawheel 是一个基于 [MCP（Model Context Protocol）](https://modelcontextprotocol.io/) 的 stdio 服务。它对外暴露一个工具 `find_wheel`，内部采用**适配器模式（Adapter Pattern）**组织数据源。

```
┌─────────────────────────────────────────────────────────────┐
│                      AI 客户端（Trae/Cursor/...）            │
│                                                             │
│   用户: "我想做一个 markdown 转 pdf 的工具"                  │
│                           │                                 │
│                           ▼                                 │
│              AI 自动调用 find_wheel 工具                     │
└───────────────────────────┬─────────────────────────────────┘
                            │ MCP stdio 协议
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      findawheel MCP 服务                     │
│                                                             │
│   ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│   │  Server     │→ │ findWheelTool│→ │QueryClassifier  │   │
│   │  (MCP 入口) │  │  (编排器)     │  │ (意图分类)      │   │
│   └─────────────┘  └──────────────┘  └────────┬────────┘   │
│                                                │            │
│                            ┌───────────────────┼──────┐    │
│                            ▼                   ▼      │    │
│                   ┌──────────────┐  ┌──────────────┐  │    │
│                   │GitHubAdapter │  │RegistryAdapter│ │    │
│                   │  (仓库搜索)  │  │(npm + crates) │ │    │
│                   └──────┬───────┘  └──────┬───────┘  │    │
│                          │                 │          │    │
│                          └────────┬────────┘          │    │
│                                   ▼                   │    │
│                          ┌──────────────┐             │    │
│                          │  Normalizer  │             │    │
│                          │ (归一化为Wheel)│             │    │
│                          └──────┬───────┘             │    │
│                                 ▼                     │    │
│                          ┌──────────────┐             │    │
│                          │MetricsEnricher│            │    │
│                          │ (指标补充)    │             │    │
│                          └──────┬───────┘             │    │
│                                 ▼                     │    │
│                          ┌──────────────┐             │    │
│                          │    Ranker    │             │    │
│                          │(过滤+评分+排序)│             │    │
│                          └──────┬───────┘             │    │
│                                 ▼                     │    │
│                          Wheel[] 返回                  │    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              AI 客户端解读结果并推荐给用户                    │
│                                                             │
│   AI: 我找到了这些轮子：                                     │
│        1. markdown-pdf — 18k stars, MIT                     │
│        2. md-to-pdf — 8k stars ...                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心数据流

一次 `find_wheel` 调用的完整流程：

### 步骤 1：接收请求

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

### 步骤 2：意图分类

`QueryClassifier` 分析 `query` 字段，判断是"功能级"还是"项目级"：

| 意图 | 含义 | 影响 |
|------|------|------|
| `feature` | 查找一个具体功能/能力（如"图片压缩"） | 优先查 npm/crates，GitHub 搜索加 `in:readme`，排序侧重下载量 |
| `project` | 查找一个完整项目（如"笔记应用"） | 优先查 GitHub，排序侧重 stars |

分类方式：关键词启发式（非 LLM）。检查 query 中是否包含预设的信号词：

- **project 信号词**：app、editor、dashboard、应用、平台...
- **feature 信号词**：parse、convert、compress、解析、转换...

信号词多的一方胜出；打平或都没命中时默认 `project`（更安全的回退）。

### 步骤 3：并行搜索多源

根据意图和 `ecosystem` 参数选择数据源，**并行调用**：

```
GitHubSourceAdapter.search()     ← 调 GitHub Search API
RegistrySourceAdapter.search()   ← 调 npm + crates.io API（内部也并行）
```

每个适配器返回各自格式的 `RawResult[]`。使用 `Promise.allSettled` 聚合——任一源失败不影响其他源。

### 步骤 4：归一化

`Normalizer` 把不同源的 `RawResult` 转成统一的 `Wheel` 结构：

| 源 | 原始字段 | 归一化后 |
|----|----------|----------|
| GitHub | `stargazers_count`、`pushed_at`、`license.spdx_id` | `metrics.stars`、`lastUpdated`、`license` |
| npm | `date`（最近发布）、`keywords` | `metrics.lastUpdated`、推断 type |
| crates | `downloads`、`updated_at` | `metrics.downloads`、`lastUpdated` |

`type` 字段的推断规则：
- GitHub 仓库：默认 `project`，若 `topics` 含 `cli`/`sdk`/`api` 则覆盖
- npm/crates 包：一律 `package`

### 步骤 5：指标补充

`MetricsEnricher` 补充 `activity`（活跃度）字段：

| 条件 | activity |
|------|----------|
| `lastUpdated` 在 6 个月内 | `high` |
| `lastUpdated` 在 2 年内 | `medium` |
| 更旧或缺失 | `low` |

### 步骤 6：过滤、评分、去重

`Ranker` 执行三步处理：

**6.1 硬过滤**（直接剔除）：
- `archived === true`（GitHub 归档仓库）
- `lastUpdated` 距今 > 3 年（明显废弃）
- `description` 为空且 `stars < 10`（信息不足）

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
```

**意图调整**：当 `intent=feature` 时，`stars` 权重 ×0.7、`downloads` 权重 ×1.5（功能级查询更看重包的下载量而非仓库 stars）。

按分数降序排列，截取 `limit` 条。

### 步骤 7：返回结果

构造响应 JSON 并通过 MCP 协议返回给 AI：

```json
{
  "query": "markdown to pdf",
  "intent": "feature",
  "total": 60,
  "wheels": [...],
  "degradedSources": ["crates"]   // 若有源失败才出现
}
```

AI 拿到结构化数据后，结合对话上下文用自然语言推荐给用户。

---

## 组件详解

### 1. Server（MCP 入口）

**文件**：`src/server.ts`

职责：
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

### 2. findWheelTool（编排器）

**文件**：`src/tools/findWheelTool.ts`

职责：编排整个查询流程，是核心协调者。

工作流：
1. 校验 `query` 非空
2. 调用 `QueryClassifier.classify()`
3. 用 `Promise.allSettled` 并行调所有适配器
4. 收集成功结果 + 记录失败源到 `degradedSources`
5. 判定 `allFailed`（所有源都 rejected 才算）
6. 串联 `normalize → enrich → rank`
7. 返回结构化结果

**降级逻辑**：
- 任一源失败：跳过该源，其他源正常返回，结果附 `degradedSources` 字段
- 全部源失败：返回 `isError: true`
- 全部源返回 0 结果：正常返回空 `wheels: []`，不算错

### 3. QueryClassifier（意图分类器）

**文件**：`src/classifier/queryClassifier.ts`

职责：判断 query 是 `feature` 还是 `project`。

实现：纯函数式关键词启发式，无状态、无副作用、不上 LLM。

```typescript
function classify(query, hint?): 'feature' | 'project'
```

**为什么不用 LLM 分类**：
- 关键词启发式足够快（微秒级），无需额外 API 调用
- MVP 阶段的 query 模式相对简单
- 二期可考虑接入 LLM 提升准确率（见路线图）

### 4. SourceAdapter（数据源适配器）

**接口文件**：`src/sources/sourceAdapter.ts`

```typescript
interface SourceAdapter {
  readonly name: string;
  search(query: string, opts: SearchOpts): Promise<RawResult[]>;
}
```

这是适配器模式的抽象——所有数据源实现同一接口，主流程不关心具体源的差异。二期加 Web 搜索源只需新增一个 adapter，不动其他代码。

#### 4.1 GitHubSourceAdapter

**文件**：`src/sources/githubSourceAdapter.ts`

**API**：`GET https://api.github.com/search/repositories`

**搜索语法构造**：
- 把自然语言 query 转成 GitHub 搜索表达式
- `intent=project` → `query in:name,description sort:stars`
- `intent=feature` → `query in:name,description,readme sort:stars`
- `ecosystem=js` → 追加 `language:JavaScript`

**鉴权**：可选 `GITHUB_TOKEN`。无 token 限流 60 次/小时，有 token 5000 次/小时。

**限流处理**：
- 解析响应头 `X-RateLimit-Remaining`
- 403 + `X-RateLimit-Remaining: 0` → 抛 `RateLimitError`
- 由主流程降级处理

#### 4.2 RegistrySourceAdapter

**文件**：`src/sources/registrySourceAdapter.ts`

聚合两个子源：

| 子源 | API | 特点 |
|------|-----|------|
| npm | `https://registry.npmjs.org/-/v1/search` | 公开，无需 token；不返回下载量 |
| crates.io | `https://crates.io/api/v1/crates` | 公开；返回 downloads 和 recent_downloads，指标最全 |

**PyPI 策略**：PyPI 没有官方搜索 API。一期不查 PyPI，由 GitHub 适配器兜底（Python 包大多有 GitHub 镜像仓库）。二期由 Web 搜索源补覆盖。

**内部聚合**：用 `Promise.allSettled` 并行查 npm 和 crates，**仅当所有子源都失败时才抛错**；任一子源有结果就正常返回。

### 5. Normalizer（归一化器）

**文件**：`src/normalize/normalizer.ts`

职责：把不同格式的 `RawResult` 映射成统一的 `Wheel`。

这是**多源聚合的关键**——不同源的 API 返回字段千差万别，必须先归一化才能统一排序。

**类型推断**：
- GitHub 仓库 + topics 含 `cli` → `type: 'cli'`
- GitHub 仓库 + topics 含 `sdk` → `type: 'sdk'`
- GitHub 仓库 + topics 含 `api` → `type: 'api'`
- GitHub 仓库无特殊 topics → `type: 'project'`
- npm/crates 包 → `type: 'package'`

**字段对齐**：
- `lastUpdated`：GitHub 用 `pushed_at`，npm 用 `date`，crates 用 `updated_at`
- `stars`：仅 GitHub 有
- `downloads`：仅 crates 有
- `license`：GitHub 用 `license.spdx_id`，crates 用 `license`，npm 一期留空

### 6. MetricsEnricher（指标补充器）

**文件**：`src/enrich/metricsEnricher.ts`

职责：基于已有指标推断 `activity`（活跃度），便于后续排序。

**为什么不直接用 `lastUpdated` 排序**：
- `lastUpdated` 是绝对时间，不同源的含义不同（GitHub 是代码推送，npm 是包发布）
- `activity` 是相对分级，更稳定、更可比

### 7. Ranker（排序器）

**文件**：`src/rank/ranker.ts`

导出 4 个函数：

| 函数 | 职责 |
|------|------|
| `filterOut(wheel)` | 硬过滤判定，返回 true 表示剔除 |
| `score(wheel, intent)` | 计算综合分（0~1） |
| `dedupe(wheels)` | 按 name 去重，保留指标更全的 |
| `rank(wheels, intent, limit)` | 串联上述三步，返回最终结果 |

---

## 数据结构

### Wheel（统一轮子结构）

这是整个系统的核心数据模型，所有源的原始数据最终都归一化成这个结构：

```typescript
interface Wheel {
  name: string;            // 仓库名 / 包名 / 服务名
  source: 'github' | 'npm' | 'pypi' | 'crates' | 'web';
  url: string;             // 主页/仓库链接
  description: string;     // 简短描述
  type: 'project' | 'package' | 'api' | 'cli' | 'sdk';
  metrics: {
    stars?: number;        // 仅 GitHub
    lastUpdated?: string;  // ISO 日期
    license?: string;      // SPDX ID，如 'MIT'
    archived?: boolean;    // 仅 GitHub
    downloads?: number;    // 仅 crates（一期）
    activity?: 'high' | 'medium' | 'low';  // 由 MetricsEnricher 推断
  };
}
```

### RawResult（各源原始结果）

判别联合类型，每个源有自己的字段：

```typescript
type RawResult = GitHubRawResult | NpmRawResult | CratesRawResult;
```

`source` 字段作为判别标签，Normalizer 用 `switch (raw.source)` 分发处理。

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
  query: string;
  intent: Intent;          // 实际使用的意图（已分类）
  total: number;           // 原始命中数（去重前）
  wheels: Wheel[];         // 排序后的结果
  degradedSources?: string[];  // 失败的源（仅有降级时出现）
}
```

---

## 质量评估机制

### 过滤规则（硬过滤）

以下情况直接剔除，不参与排序：

| 规则 | 原因 |
|------|------|
| `archived === true` | GitHub 归档仓库，已停止维护 |
| `lastUpdated` 距今 > 3 年 | 明显废弃 |
| `description` 为空 且 `stars < 10` | 信息不足，难以判断质量 |

### 评分公式

综合分 = 加权求和，归一化到 [0, 1]：

```
score = 0.3 × normalize(stars, 50000)
      + 0.3 × recencyScore(lastUpdated)
      + 0.2 × activityScore(activity)
      + 0.1 × normalize(downloads, 100000)
      + 0.1 × hasLicense(license)
```

**各子分计算**：

| 子分 | 计算方式 |
|------|----------|
| `stars` | `min(stars / 50000, 1)` — 5 万 stars 满分 |
| `recency` | 1 年内 = 1.0；1-2 年 = 0.7；2-3 年 = 0.4；更旧 = 0 |
| `activity` | high = 1.0；medium = 0.5；low = 0.2 |
| `downloads` | `min(downloads / 100000, 1)` — 10 万下载满分 |
| `license` | 有 = 1.0；无 = 0 |

**意图调整**：

当 `intent = 'feature'` 时：
- `stars` 权重 × 0.7（功能级查询不太看重仓库 stars）
- `downloads` 权重 × 1.5（更看重包的实际使用量）

### 权重设计思路

| 指标 | 权重 | 为什么 |
|------|------|--------|
| stars + recency | 各 0.3（共 0.6） | 社区认可度和维护活跃度是质量的最强信号 |
| activity | 0.2 | 区分"近期还活着"和"只是没归档" |
| downloads | 0.1 | 仅 crates 有，权重低避免偏袒包源 |
| license | 0.1 | 有 license 是基本要求，但不强求特定协议 |

> ⚠️ **MVP 声明**：评分公式为启发式权重，未做机器学习/调参。能跑出"明显的垃圾在后、明显的好货在前"就达标。精确排序是二期增强项。

---

## 错误处理与降级

### 设计原则

**部分成功优于全失败**——任一数据源失败不应阻断整个查询。

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
|------|------|-----------|
| 单个适配器抛错 | 跳过该源，其他源正常返回，附 `degradedSources` | 200 |
| 所有适配器全失败 | 返回 `isError: true`，说明"所有数据源暂不可用" | 200 + isError |
| `query` 为空 | 返回 `isError: true`，提示必填 | 200 + isError |
| 单源返回 0 结果 | 不算错，正常聚合 | 200 |
| 全部源 0 结果 | 正常返回空 `wheels: []` | 200 |

### 不重试策略

一期**不实现自动重试**：
- 避免雪崩效应（限流时重试会加重负担）
- 简化实现
- 二期可加指数退避重试（见路线图）

---

## MCP 协议交互

findawheel 是 **stdio 类型**的 MCP 服务，通过标准输入输出与 AI 客户端通信。

### 通信流程

```
AI 客户端                          findawheel
   │                                   │
   │──── initialize ─────────────────→│
   │←── serverInfo (findawheel) ──────│
   │                                   │
   │──── notifications/initialized ──→│
   │                                   │
   │──── tools/list ─────────────────→│
   │←── [{name: "find_wheel", ...}]──│
   │                                   │
   │──── tools/call (find_wheel) ────→│
   │                                   │
   │       （findawheel 内部处理：      │
   │        分类 → 搜索 → 归一化 →      │
   │        补充 → 排序）               │
   │                                   │
   │←── {content: [{text: JSON}]} ───│
   │                                   │
```

### 工具注册信息

```json
{
  "name": "find_wheel",
  "description": "Search for existing reusable wheels... Call this BEFORE implementing a new idea to avoid reinventing the wheel.",
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

### 关键设计：工具只给数据，不写文案

`find_wheel` 返回**结构化 JSON**，不返回自然语言推荐文案。

**为什么**：
- MCP 工具的职责是拿数据，调用方 AI 的职责是理解和呈现
- AI 能结合对话上下文做更精准的推荐（知道用户在做什么项目、用什么技术栈）
- 避免工具和 AI 重复生成文案

---

## 一期不做的事（YAGNI 边界）

以下功能**明确不在一期范围**，避免过度设计：

- ❌ npm 下载量查询（API 调用多、易限流）
- ❌ PyPI 搜索（无官方 API）
- ❌ README / 示例代码抓取
- ❌ 结果缓存（一期流量低，实时查够用）
- ❌ 自动重试
- ❌ 多用户、鉴权、服务端托管
- ❌ 社区评论、收藏夹、Web UI

这些会在二期按需加入，见 [README 路线图](../README.md#-路线图)。

---

## 进一步阅读

- [使用指南](./USAGE.md) — 下载、安装、配置、使用全流程
- [设计规格](./superpowers/specs/2026-07-02-findawheel-design.md) — 完整设计文档（含决策过程）
- [实现计划](./superpowers/plans/2026-07-02-findawheel.md) — 16 个任务的 TDD 实现步骤
- [MCP 协议官网](https://modelcontextprotocol.io/) — 理解 MCP 协议本身
