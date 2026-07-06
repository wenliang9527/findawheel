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

findawheel 是一个基于 [MCP（Model Context Protocol）](https://modelcontextprotocol.io/) 的 stdio 服务。它对外暴露五个工具 `find_wheel`、`suggest_queries`、`get_wheel_details`、`record_feedback` 和 `search_knowledge`，内部采用**适配器模式（Adapter Pattern）**组织数据源。

> 🎯 **RAG 范式定位**：findawheel 是 AI 编程的"上下文增强器"——**检索器只负责召回，判断权交给 AI**。工具描述中明确声明"findawheel does NOT filter results by relevance — YOU must judge relevance yourself"。findawheel 不做硬性相关性过滤，反向意图/核心词缺失等判断由 AI 调用方自行完成。

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
| `coreWords` | 核心动词/名词（优先动词） | GitHub 引号短语精确匹配；Ranker queryCoverage 软排序 |
| `modifierWords` | 修饰词 | 加权匹配 |
| `formatWords` | 格式词（pdf/word/ppt/excel/docx/html/markdown/json） | 传给适配器构造查询（不做硬过滤） |
| `expandedQuery` | 翻译+同义词扩展后的英文 query | 传给所有适配器 |
| `fuzzyQuery` | 同义词泛化后的副搜索 query | 用于副搜索 |

> ⚠️ **Phase 6 简化**：删除了 `antonymWords`（反义词）字段。反向意图的判断交给 AI 调用方——`find_wheel` 工具描述明确告知"结果可能含不相关项目（如反向意图 remove watermark），需自行识别并跳过"。

**QueryClassifier 判断意图**：

| 意图 | 含义 | 影响 |
|:-----|:-----|:-----|
| `feature` | 查找一个具体功能/能力（如"图片压缩"） | 优先查 npm/crates，GitHub 搜索加 `in:readme`，排序侧重下载量 |
| `project` | 查找一个完整项目（如"笔记应用"） | 优先查 GitHub，排序侧重 stars |

**分类方式**：关键词启发式（非 LLM）。检查 query 中是否包含预设的信号词：

- **project 信号词**：`app`、`editor`、`dashboard`、`应用`、`平台`...
- **feature 信号词**：`parse`、`convert`、`compress`、`解析`、`转换`...

信号词多的一方胜出；打平或都没命中时默认 `project`（更安全的回退）。

> 💡 **中文翻译**：QueryParser 内部调用 `queryTranslator`，内置 200+ 词的中英技术术语映射表（如"图片"→"image"、"水印"→"watermark"），中文 query 会被翻译成英文后再拆解。

### 步骤 2.5️⃣ 智能数据源路由（Source Router）

为节省 API 配额（GitHub 10 req/min、Gitee 60 req/hour、Libraries.io/Exa/Tavily 等）并减少 token 消耗，`sourceRouter` 会根据 query 类型选择合适的数据源子集，跳过明显不相关的源。

**路由优先级**（第一条命中生效）：

| 优先级 | 规则名 | 触发条件 | 选中源 |
|:---:|:-----|:-----|:-----|
| 1 | `python-ecosystem` | `ecosystem=python` | PyPI/GitHub/Libraries.io/Web |
| 2 | `js-ts-ecosystem` | `ecosystem=js/ts` | npm/GitHub/Libraries.io/Web |
| 3 | `compiled-ecosystem` | `ecosystem=rust/go/java` | GitHub/Libraries.io/Web |
| 4 | `cpp-arduino-ecosystem` | `ecosystem=cpp/arduino` | GitHub/Gitee/GitHub-Code/PapersWithCode/Web |
| 5 | `hardware-keywords` | query 含 `stepper/motor/servo/esp32/stm32/...` | 同 cpp-arduino |
| 6 | `vscode-extension` | query 含 `vscode/extension/插件/扩展` | VSCode-Marketplace/GitHub/Web |
| 7 | `ai-ml-model` | query 含 `llm/transformer/bert/gpt/model+ML` | HuggingFace/PapersWithCode/GitHub/Web |
| 8 | `paper-algorithm` | query 含 `paper/algorithm/论文/算法` | PapersWithCode/GitHub/Web |
| 9 | `code-snippet` | query 含 `snippet/example/function/片段/示例/函数/实现` | GitHub-Code/GitHub/Web |
| 10 | `frontend-ui` | query 含 `react/vue/component/前端/组件/表格/图表` | npm/GitHub/Libraries.io/Web |
| 兜底 | `fallback-all` | 无强信号匹配 | 全搜（11 个源，保持召回完整）|

> 💡 **中文正则限制**：`\b` 是英文词边界，中文上下文不生效。中文关键词（如"插件/论文/算法"）单独用 `/(插件|扩展)/` 形式的不带 `\b` 正则匹配。

**兜底扩展（Fallback Expansion）**：当路由跳过了源但召回不足时，自动扩展到全源重搜：

- 触发条件（**严格阈值，OR 关系**）：`top 1 stars < 10` 或 `总结果 < 5 条`
- 扩展后不再二次扩展（避免无限循环）
- 扩展后 `skippedSources` 字段不再返回（全部源都搜过了）

**输出透明度**：未触发扩展时返回 `skippedSources` + `routingReason` 字段，AI 调用方可据此判断召回范围。

### 步骤 3️⃣ 主搜索 + 副搜索并行

findWheelTool 同时发起两组搜索（**仅针对路由选中的源**）：

```
主搜索 (precise):  用 expandedQuery 调路由选中的适配器
副搜索 (fuzzy):    用 fuzzyQuery（同义词泛化）调路由选中的适配器
```

两组搜索并行执行，结果合并后去重。这能扩大召回——比如搜"monitor"时副搜索会用"observer/watcher"找到主搜索漏掉的项目。

**每个适配器内部**也是并行调用各自的子源：

```
GitHubSourceAdapter.search()            ← GitHub Search API（引号短语精确匹配）
GitHubCodeSourceAdapter.search()        ← GitHub Code Search（/search/code,代码片段,text-match）
GiteeSourceAdapter.search()             ← Gitee OpenAPI
RegistrySourceAdapter.search()          ← npm + crates.io API（内部也并行）
WebSourceAdapter.search()               ← Exa 主，失败 fallback Tavily
VscodeMarketplaceSourceAdapter.search() ← VS Code Marketplace（extensionquery POST）
PapersWithCodeSourceAdapter.search()    ← Papers with Code（/api/v1/papers/,论文/算法）
HuggingfaceSourceAdapter.search()      ← HuggingFace Hub（/api/models,pretrained model）
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

> ℹ️ **P0-3 后 activity 的角色变化**：`activity` 不再被 `score()` 函数使用（原 0.2 权重已删，与 `recency` 重复计分）。现在 `activity` 仅供 `Recommender` 在生成推荐理由时参考（如"活跃维护"描述），不再直接影响排序分数。`score()` 统一用 `recency` 的连续衰减函数计算时间新鲜度。

### 步骤 6️⃣ 推荐等级 + 基础过滤 + 评分 + 去重

`Recommender` 先为每个 wheel 计算推荐等级，`Ranker` 再执行**基础过滤**、评分、去重。

> ⚠️ **Phase 6 简化**：删除了 `isMissingCoreConcept`（核心词缺失）、`isReverseIntent`（反向意图）、`formatWords` AND 必命中、`antonymExcludes` NOT 排除等硬过滤函数。相关性判断交给 AI 调用方——主流库 Neutree/COMTool 等不再被规则误杀。

**6.0 推荐等级计算**（Recommender）：

基于 stars、活跃度、描述命中数等综合计算 `matchScore`（0~1.1），映射到四个等级：

| 等级 | matchScore | 含义 |
|:-----|:-----|:-----|
| `highly_recommended` | ≥ 0.6 且 stars ≥ 1000 | 强烈推荐，命中药准、质量高 |
| `recommended` | ≥ 0.4 | 推荐，相关但稍弱 |
| `optional` | ≥ 0.2 | 可选，仅供参考 |
| `not_recommended` | < 0.2 | 不推荐，相关性低 |

同时生成 `reason`（中文理由）、`matchedKeywords`（命中的查询词）和 `recallReason`（召回解释，Phase 7 新增）。

> ℹ️ **统一 stars 分母**（Phase 6 简化）：Recommender 的 `popularityScore` 从 6 领域查表（`DOMAIN_STARS_DENOMINATOR`）简化为统一 **10000**。Ranker 基础排序中的 stars 归一化仍是 50000（这部分未变）。AI 拿到 stars 原值后自己判断领域相对热度，不再依赖领域特化配置。

**6.1 基础过滤**（仅剔除明显垃圾，直接剔除）：
- `archived === true`（GitHub 归档仓库）
- `lastUpdated` 距今 > 3 年（明显废弃）
- `description` 为空且 `stars < 10`（信息不足）
- **聚合仓库检测**：name/description 含 `awesome`/`curated`/`collection`/`list` 等关键词

> ⚠️ **不再过滤**：反向意图、核心词缺失、格式词缺失等场景。这些判断交给 AI——`find_wheel` 工具描述明确告知"结果可能含不相关项目，需自行识别并跳过"。

**6.2 去重**：
- 按 `name`（小写）合并
- 保留指标字段更多的那条（如 `lodash` 同时出现在 npm 和 GitHub，保留 GitHub 版本因为多了 `stars`）
- **topics 合并**（P1-6 新增）：同名 wheel 的 topics 数组合并去重（GitHub topics + npm keywords），提升后续 `topicsMatchBonus` 加分准确性

**6.3 评分排序**：

P0-2 重构后采用**基础分归一化 + bonus 叠加**结构，总分上限 1.5：

```
基础分 (<=1.0):
  stars      × 0.25    ← 归一化到 [0, 50000]
  recency    × 0.2     ← 连续线性衰减:1年内=1.0,1-3年线性衰减到0.1
  coverage   × 0.4     ← 描述命中所有 query 内容词得 0.4,部分按比例
  downloads  × 0.1     ← 归一化到 [0, 1000000]
  license    × 0.05    ← 有 license = 1.0,无 = 0

+ bonus (<=0.5,合并上限):
  descBonus    × 0.15   ← 描述命中率软加分
  nameBonus    × 0.15   ← name 命中加分(name 权重高于 description)
  phraseBonus  × 0.1    ← 精确短语匹配加分
  topicsBonus  × 0.1    ← topics 命中加分

= 总分 (<=1.5)
```

**额外调整**：
- **高 star 零命中降权**：stars 高但 query 关键词一个都没命中，`stars` 权重 ×0.3（Phase 6 强化为更激进的下沉，原 0.7）
- **意图调整**：当 `intent=feature` 时，`stars` 权重 ×0.7、`downloads` 权重 ×1.5

> ℹ️ **P0-3 简化**：删除了 `activityScore`（原 0.2 权重），因为它和 `recencyScore` 都基于 `lastUpdated`，存在重复计分。现在统一用 `recency` 的连续衰减函数（无阶梯跳跃）。
>
> ℹ️ **Recommender 中的 popularityScore**：用统一分母 **10000**（Phase 6 简化，原 6 领域查表），与 Ranker 的 50000 分母独立。

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
2. 调用 QueryParser.parse() 拆解核心词/修饰词/格式词/同义词（Phase 6 简化后无反义词）
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
| `coreWords` | 核心词（优先动词，如 compress/parse） | GitHub 引号短语精确匹配；Ranker queryCoverage 软排序 |
| `modifierWords` | 修饰词（如 cli/high-performance） | 加权匹配 |
| `formatWords` | 格式词（pdf/word/excel 等 30+） | 传给适配器构造查询（不做硬过滤） |
| `expandedQuery` | 翻译+扩展后的英文 query | 传给所有适配器 |
| `fuzzyQuery` | 同义词泛化后的副搜索 query | 副搜索用 |

> ⚠️ **Phase 6 简化**：删除了 `antonymWords`（反向意图词）字段。反向意图的识别交给 AI 调用方。

**动词优先策略**：核心词选择时优先从动词中取（动词通常表达核心意图），而非简单取前 2 个内容词。

**同义词表**：内置 monitor→observer/watcher、compress→shrink/optimize、motor→actuator 等映射，用于副搜索扩大召回。

> 💡 **中文翻译**：`queryTranslator` 内置 200+ 词中英技术术语映射（如"图片"→"image"、"水印"→"watermark"、"解析"→"parse"），中文 query 会被翻译成英文后再拆解。

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

> ℹ️ **`per_page` / `page_size` 各 adapter 取值不一致（P2-18 文档化）**
>
> 各数据源 API 限流策略不同，故 per_page 取值有意不统一：
>
> | Adapter | 参数 | 值 | 原因 |
> |:--------|:-----|:---|:-----|
> | GitHub | `per_page` | 50 | REST API 上限 100，取 50 平衡召回与限流（5000 req/h）|
> | GitLab | `per_page` | 50 | 上限 100，取 50 平衡召回与限流 |
> | Gitee | `per_page` | 20 | 匿名 60 req/h 限流严，保守用 20 |
> | GitHub Code Search | `per_page` | 20 | 限流 10 req/min 极严，保守用 20 控制流量 |
> | npm (`registry.npmjs.org`) | `size` | 20 | 默认上限 20 |
> | crates.io | `per_page` | 20 | API 上限 100，取 20 平衡召回与限流 |
> | Papers with Code | `items_per_page` | 20 | API 上限 100，取 20 平衡召回与限流 |
> | HuggingFace | N/A | - | 用 `/api/models?search=...` 不分页 |
> | VS Code Marketplace | N/A | - | 用 POST body 不带 per_page |
>
> 取值原则：**限流严的源用小 per_page**（防止触发限流），**限流宽的源用大 per_page**（提高召回）。
> 统一一个值会导致限流严的源频繁触发 429，或限流宽的源召回不足。

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
- **核心词精确匹配**（Phase 6 简化）：单词不加引号（如 `watermark` 走词干匹配），多词加引号（如 `"stepper motor"` 精确匹配）；删除了 embedded 领域"不加引号/只用第一个词"等特殊逻辑
- **聚合仓库排除**：自动追加 `NOT awesome in:name`
- `per_page` 设为 50（默认 20）

> ⚠️ **Phase 6 简化**：删除了反义词 `NOT word` 排除逻辑（`antonymExcludes` 字段已移除）。反向意图的识别交给 AI 调用方。

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

> ℹ️ **P1-4 统一 http 层**：Exa 和 Tavily 现在都走 `httpPost`（`src/util/http.ts`），共享超时/重试/错误处理逻辑。5xx 错误会自动指数退避重试(原直接用 `fetch` 无重试)。

**Exa 请求**：
- Header: `x-api-key`
- Body: `{ query, numResults: 10, contents: { text: true, highlights: true } }`
- 返回 title/url/highlights/text/score

**Tavily 请求**：
- Body: `{ api_key, query, search_depth: 'basic', max_results: 10, include_domains: [github.com, npmjs.com, crates.io, pypi.org] }`
- 限定域名到主流代码托管和包管理站点，避免无关结果

> 💡 **零配置兼容**：两个 key 都未配置时，WebSourceAdapter 直接返回空数组，findawheel 仍可正常使用其他四个源。

#### 4.8 GitHubCodeSourceAdapter

| | |
|:---|:---|
| 📄 **文件** | `src/sources/githubCodeSourceAdapter.ts` |
| 🌐 **API** | `GET https://api.github.com/search/code` |

**用途**：搜代码片段而非仓库，补「代码片段」盲区（如"想找 parser 实现示例"）。

**关键差异**（对比 `githubSourceAdapter`）：
- 调用 `/search/code` 而非 `/search/repositories`
- **强制认证**：无 `GITHUB_TOKEN` 直接返回空数组（Code Search API 要求登录）
- 限流更严格：10 req/min（认证后），无匿名访问
- 结果是「文件级」而非「仓库级」，`RawResult` 包含文件路径 `path` 和命中片段 `textFragment`
- 只搜默认分支、<384KB 文件
- 需主动请求 `application/vnd.github.text-match+json` media type 才能拿到代码片段

**查询构造**：`query + language:<ecosystem映射>`（如 `addClass in:file language:js`）。

**字段映射**：
- `name` = `owner/repo`（仓库名）
- `url` = 文件 `html_url`
- `path` = 文件路径（如 `src/utils/parser.ts`）
- `textFragment` = 命中的代码片段（第一个 `text_matches` 的 `fragment`）
- `stars` = 仓库 `stargazers_count`
- 归一化后 `name` 拼接成 `owner/repo#path`，`description` 拼接仓库描述 + `textFragment`

**限流处理**：403 → 抛 `RateLimitError`，其他 HTTP 错误 → 抛 `SourceError`。

#### 4.9 VscodeMarketplaceSourceAdapter

| | |
|:---|:---|
| 📄 **文件** | `src/sources/vscodeMarketplaceSourceAdapter.ts` |
| 🌐 **API** | `POST https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery` |

**用途**：搜 VS Code 插件，补「IDE 插件」盲区。

**关键差异**：
- **POST 请求**（`http.ts` 只有 `httpGet`，这里直接用 `fetch`）
- **无需 key**（路径含 `_apis/public`，公开 API）
- 非官方文档化 API，微软未承诺 SLA，结构可能变更
- 请求体是 GraphQL-like 结构，`filterType=8` 是 SearchText，`filterType=12` 是 TargetVSCode
- `flags=914` 让 Marketplace 返回统计信息（installCount/rating）

**请求体**：
```json
{
  "filters": [{
    "criteria": [
      { "filterType": 8, "value": "<query>" },
      { "filterType": 12, "value": "Microsoft.VisualStudio.Code" }
    ]
  }],
  "assetTypes": [],
  "flags": 914
}
```

**字段映射**：
- `name` = `publisher.extensionName`（如 `ms-python.python`）
- `url` = `https://marketplace.visualstudio.com/items?itemName=<fullName>`
- `description` = `displayName - shortDescription`
- `installCount` = statistics 数组里 `install` 项的值
- `averageRating` / `ratingCount` = statistics 数组里 `averagerating` / `ratingcount`
- `lastUpdated` = `versions[0].lastUpdated`

**错误处理**：HTTP 非 2xx → 抛 `SourceError`；网络错误/abort → 抛 `SourceError`。

#### 4.10 PapersWithCodeSourceAdapter

| | |
|:---|:---|
| 📄 **文件** | `src/sources/papersWithCodeSourceAdapter.ts` |
| 🌐 **API** | `GET https://paperswithcode.com/api/v1/papers/` |

**用途**：搜论文与算法实现，补「算法」盲区（如"想找最新的图像分割算法"）。

**关键差异**：
- **无需 key**（公开 API）
- GET 请求，可用 `httpGet`
- API 文档质量较差（老旧），结构可能不稳定，代码做防御性解析
- 论文没有 stars 概念，但有关联 repo（本期暂不抓 stars，留空）
- 返回论文标题/摘要/年份，以及 arxiv 链接

**查询参数**：`q=<query>&page=1&items_per_page=20`。

**字段映射**：
- `name` = 论文 `title`
- `url` = `https://paperswithcode.com/paper/<id>`
- `description` = `abstract`
- `year` = 从 `published` 字段提取（可能是 `2017-06-12` 或 `2017`）
- `repoUrl` = `url_abs`（arxiv 链接，便于用户进一步查看）

**错误处理**：HTTP 错误 → 抛 `SourceError`；网络错误 → 抛 `SourceError`。

---

#### 4.11 HuggingfaceSourceAdapter（Phase 7 新增）

| | |
|:---|:---|
| 📄 **文件** | `src/sources/huggingfaceSourceAdapter.ts` |
| 🌐 **API** | `GET https://huggingface.co/api/models` |

**用途**：搜 pretrained AI 模型，补「AI 模型」盲区（如"想找图像分割模型""语音识别模型"）。

**关键差异**：
- **无需 key**（公开 API，但有限流；带 token 可提升额度）
- GET 请求，可用 `httpGet`
- API 直接返回数组（非 `{ results: [...] }` 结构），代码做 `Array.isArray` 防御
- 模型名格式为 `org/model-name`（类似 GitHub 的 owner/repo）
- 用 `likes` 近似 stars（HuggingFace 无 stars 概念，likes 是社区点赞）
- 返回下载数/点赞数/任务类型/框架

**查询参数**：`search=<query>&limit=20&full=false&sort=downloads&direction=-1`（按下载量降序，优先返回主流模型）。

**字段映射**：
- `name` = 模型 `id`（如 `bert-base-uncased`）
- `url` = `https://huggingface.co/<id>`
- `description` = `pipeline_tag` + `library_name` + tags 摘要（前 5 个）
- `stars` = `likes`（近似热度）
- `downloads` = `downloads`
- `lastUpdated` = `lastModified`
- `pipelineTag` = `pipeline_tag`（任务类型，如 `text-classification`）
- `libraryName` = `library_name`（框架，如 `transformers`）

**归一化**：`type` 设为 `'model'`（新增的 WheelType），与 `'project'`/`'package'` 等区分。

**错误处理**：HTTP 错误 → 抛 `SourceError`；网络错误 → 抛 `SourceError`。

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
| `filterOut(wheel)` | 基础硬过滤判定，返回 true 表示剔除；仅检查 archived/废弃/聚合仓库（Phase 6 简化后） |
| `score(wheel, intent, queryKeywords)` | 计算综合分，采用**基础分(1.0) + bonus(0.5)**结构(P0-2 重构),含 queryCoverage/descBonus/nameBonus/phraseBonus/topicsBonus 和高 star 零命中降权 |
| `dedupe(wheels)` | 按 name 去重,保留指标更全的;**合并 topics**(P1-6 新增,GitHub topics + npm keywords 合并去重) |
| `rank(wheels, intent, limit, queryKeywords)` | 串联上述三步，返回最终结果 |

**额外辅助函数**：
- `isAggregateRepo(wheel)` — 检测 awesome/curated/collection/list 聚合仓库
- `isZeroHit(wheel, queryWords)` — 零命中检测（用于高 star 零命中降权）
- `mergeTopics(a, b)` — 合并两个 topics 数组(去重,保留顺序)(P1-6 新增)

> ⚠️ **Phase 6 简化删除的函数**：
> - `isMissingCoreConcept(wheel, coreWords)` — 核心词缺失过滤（已删，判断交给 AI）
> - `isReverseIntent(wheel, antonymWords)` — 反向意图过滤（已删，判断交给 AI）
> - `filterOut` 不再接受 `coreWords`/`antonymWords`/`formatWords` 参数
>
> ⚠️ **P0-3 删除的函数**：
> - `activityScore(activity)` — 已删,与 `recencyScore` 重复计分(都基于 lastUpdated)。统一用 `recency` 的连续衰减函数

---

### 8. Recommender（推荐器）

| | |
|:---|:---|
| 📄 **文件** | `src/rank/recommender.ts` |

**职责**：为每个 wheel 计算推荐等级和理由，填充 `match` 字段。

**输入**：wheel + queryKeywords（Phase 6 简化后不再接受 domain 参数）

**输出**：`WheelMatch`（score / recommendation / reason / matchedKeywords / recallReason）

**计算逻辑**：
1. 统计 name + description 命中的查询词数（核心词权重高）
2. 综合 stars、活跃度、命中数计算 `matchScore`（0~1）；stars 用统一分母 10000（Phase 6 简化，删除 DOMAIN_STARS_DENOMINATOR 查表）
3. 按阈值映射到四个推荐等级
4. 生成中文 `reason`（如"命中核心词 markdown/pdf，stars 高，活跃维护"）
5. 收集 `matchedKeywords` 列表
6. 生成 `recallReason`（Phase 7 新增，召回解释）：简短说明为什么召回该 wheel，形如"命中 stepper/motor;3.0k stars;活跃维护"，帮 AI 快速判断相关性

> 💡 Recommender 在 Ranker **之前**运行——先填好 `match` 字段，Ranker 的过滤和评分才能引用 match 信息。

---

## 📐 数据结构

### Wheel（统一轮子结构）

> 📌 这是整个系统的核心数据模型，所有源的原始数据最终都归一化成这个结构。

```typescript
interface Wheel {
  name: string;            // 仓库名 / 包名 / 服务名
  source: WheelSource;     // 'github' | 'gitlab' | 'gitee' | 'npm' | 'pypi' | 'crates' | 'librariesio' | 'web' | 'github-code' | 'vscode-marketplace' | 'paperswithcode' | 'huggingface'
  url: string;             // 主页/仓库链接
  description: string;     // 简短描述
  type: WheelType;         // 'project' | 'package' | 'api' | 'cli' | 'sdk' | 'snippet' | 'extension' | 'paper' | 'model'
  metrics: {
    stars?: number;        // GitHub / Gitee / GitLab / HuggingFace(likes 近似)
    lastUpdated?: string;  // ISO 日期
    license?: string;      // SPDX ID，如 'MIT'
    archived?: boolean;    // 仅 GitHub/GitLab
    downloads?: number;    // crates + npm(补充后) + HuggingFace + VSCode(installCount)
    activity?: 'high' | 'medium' | 'low';  // 由 MetricsEnricher 推断(注:P0-3 后 score 不再使用,仅供 Recommender 参考)
  };
  topics?: string[];       // 仓库标签(GitHub topics / GitLab topics / npm keywords),用于 topicsMatchBonus 加分
  match?: WheelMatch;      // 由 Recommender 填充
  details?: WheelDetails; // 仅 top N 结果内联填充(README/code/release/license)
  hasDetails?: boolean;    // 标记详情已预抓取并缓存,AI 可调 get_wheel_details 懒加载
}

interface WheelMatch {
  score: number;                  // 0~1.1，匹配度（0.6 相关度 + 0.3 热度 + 0.2 活跃度）
  recommendation: 'highly_recommended' | 'recommended' | 'optional' | 'not_recommended';
  reason: string;                 // 中文推荐理由
  matchedKeywords: string[];      // 命中的查询词
  feedbackDelta?: number;          // 用户反馈调整量(like +0.2/click +0.05/hide -0.5)
  recallReason?: string;          // 召回解释(Phase 7 新增)
}
```

### RawResult（各源原始结果）

判别联合类型，每个源有自己的字段：

```typescript
type RawResult =
  | GitHubRawResult      // GitHub /search/repositories
  | GitlabRawResult      // GitLab /api/v4/projects
  | GiteeRawResult       // Gitee /api/v5/search/repositories
  | NpmRawResult         // npm registry
  | PypiRawResult        // PyPI HTML 解析
  | CratesRawResult      // crates.io
  | LibrariesIoRawResult // libraries.io
  | WebRawResult         // Exa/Tavily web 搜索
  | GitHubCodeRawResult  // GitHub /search/code (代码片段)
  | VscodeExtensionRawResult // VS Code Marketplace
  | PaperRawResult       // Papers with Code
  | HuggingfaceRawResult;// HuggingFace Hub
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
  exclude?: string[];    // Phase 7:要排除的 wheel name 列表(AI 二次筛选用)
}

interface FindWheelOutput {
  summary: {                        // 引导 AI 分组列出所有结果
    instruction: string;            // 给 AI 的展示指引
    groups: Array<{                 // 按推荐等级分组
      level: Recommendation;
      label: string;                // 该等级的中文名
      items: string[];              // 结果名列表
    }>;
    warning?: string;               // 低质量结果警告(top 1 stars < 10 时触发)
  };
  query: string;
  intent: Intent;          // 实际使用的意图（已分类）
  total: number;           // 原始命中数（去重前）
  wheels: Wheel[];         // 排序后的结果（每个带 match 字段）
  degradedSources?: string[];  // 失败的源（仅有降级时出现）
  cached?: boolean;        // 命中缓存时为 true
}
```

### suggest_queries 工具

除了 `find_wheel`，findawheel 还注册了 `suggest_queries` 工具，用于 AI 不确定怎么构造搜索词时生成建议。

**输入**：`query`（用户原始描述）、可选 `ecosystem`

**输出**：4 个角度的搜索词变体 + 推荐选项 + 可选的 `recommendedEcosystem`

```typescript
interface SuggestQueriesOutput {
  originalQuery: string;
  translatedQuery: string;
  intent: 'feature' | 'project';
  suggestions: QuerySuggestion[];  // 4 个变体:precise/action_oriented/fuzzy/concise
  recommended: string;            // 推荐的搜索词(动作导向优先)
  reason: string;
  recommendedEcosystem?: string;  // 硬件类 query 时自动推荐 'arduino'/'cpp'
}
```

#### 硬件类 ecosystem 自动推荐

当 query 包含硬件类关键词(stepper/motor/servo/encoder/pwm/esp32/stm32/raspberry 等)时，`suggest_queries` 自动推荐 `recommendedEcosystem` 字段，AI 应把它传给 `find_wheel` 的 `ecosystem` 参数。原因是这类库主要分布在 C++/Arduino 生态（如 AccelStepper、Marlin、GRBL），用 python/js 搜会漏掉主流库。

推荐规则优先级：
1. 用户显式传 `ecosystem` 参数 → 用用户的（不覆盖）
2. `parseQuery` 从 query 识别出 ecosystem（如 "python 库" → python）→ 用识别到的
3. 硬件关键词检测：
   - 含 `arduino` → `arduino`
   - 含 `esp32`/`stm32`/`raspberry`/`microcontroller`/`mcu`/`embedded`/`hal`/`gpio` → `cpp`
   - 含通用硬件词（`stepper`/`motor`/`servo`/`encoder`/`pwm`/`pulse`/`driver`）→ 默认 `arduino`（Arduino 生态库最丰富）

> 💡 AI 应在用户表达模糊需求时先调 `suggest_queries`，选最合适的变体再调 `find_wheel`。若输出包含 `recommendedEcosystem`，必须传给 `find_wheel` 的 `ecosystem` 参数。

---

## 📊 质量评估机制

### 基础过滤规则（Phase 6 简化后）

> 🎯 **RAG 范式**：findawheel 只做基础垃圾剔除，**相关性判断交给 AI 调用方**。

以下情况直接剔除，不参与排序：

| 规则 | 原因 |
|:-----|:-----|
| `archived === true` | GitHub 归档仓库，已停止维护 |
| `lastUpdated` 距今 > 3 年 | 明显废弃 |
| `description` 为空 且 `stars < 10` | 信息不足，难以判断质量 |
| name/description 含 `awesome`/`curated`/`collection`/`list` | 聚合仓库，不是具体工具 |

> ⚠️ **Phase 6 简化删除的过滤**（这些场景交给 AI 识别）：
> - ~~命中反向词但不命中核心词~~ → AI 看到 description 自己识别"反向意图"
> - ~~name + description 不包含任何 coreWords~~ → 主流库 Neutree/COMTool 不再被误杀
> - ~~query 含格式词但结果不命中任何格式词~~ → AI 自己判断格式是否匹配

### 评分公式

P0-2 重构后采用**基础分归一化(1.0) + bonus(上限 0.5)**结构,总分上限 1.5,语义清晰:

```
基础分 (<=1.0):
  stars      × 0.25    ← 归一化到 [0, 50000]
  recency    × 0.2     ← 连续线性衰减:1年内=1.0,1-3年线性衰减到0.1,3年以上=0
  coverage   × 0.4     ← 描述命中所有 query 内容词得 0.4,部分按比例
  downloads  × 0.1     ← 归一化到 [0, 1000000](P0 调整,原 100000)
  license    × 0.05    ← 有 license = 1.0,无 = 0

+ bonus (<=0.5,合并上限):
  descBonus    × 0.15   ← 描述命中率软加分
  nameBonus    × 0.15   ← name 命中加分(name 权重高于 description)
  phraseBonus  × 0.1    ← 精确短语匹配加分(description 含完整 query 短语)
  topicsBonus  × 0.1    ← topics 命中加分(仓库标签命中 query 词)

= 总分 (<=1.5)
```

**各子分计算**：

| 子分 | 计算方式 |
|:-----|:---------|
| `stars`（Ranker） | `min(stars / 50000, 1)` — 5 万 stars 满分（未变） |
| `popularityScore`（Recommender） | `min(stars / 10000, 1) × 0.3` — Phase 6 统一分母（原 6 领域查表） |
| `recency` | **连续线性衰减**（P0-3 替代阶梯式）:1 年内 = 1.0;1-3 年线性衰减到 0.1;3 年以上 = 0 |
| ~~`activity`~~ | **已删除**（P0-3,与 recency 重复计分） |
| `downloads` | `min(downloads / 1000000, 1)` — 100 万下载满分（P0 调整,原 10 万） |
| `license` | 有 = 1.0；无 = 0 |
| `coverage` | 描述命中所有 query 内容词 = 0.4；部分命中按比例；都不命中 = 0 |
| `descBonus` | 描述命中率 × 0.15（软加分,Phase 6 保留） |
| `nameBonus` | name 命中 query 词加分,上限 0.15（P0-2 新增,name 权重高于 description） |
| `phraseBonus` | description 含完整 query 短语(前 3 词)加 0.1（P0-2 新增） |
| `topicsBonus` | topics 命中 query 词加分,上限 0.1（P0-2 新增,需源提供 topics 字段） |

**额外调整**：

| 调整 | 触发条件 | 效果 |
|:-----|:-----|:-----|
| 高 star 零命中降权 | stars 高但 query 关键词一个都没命中 | `stars` 权重 ×0.3（Phase 6 强化，原 0.7） |
| 意图调整（feature） | `intent=feature` | `stars` ×0.7、`downloads` ×1.5 |
| 意图调整（project） | `intent=project` | 默认权重 |

### 推荐等级映射

`Recommender` 基于综合 score 和匹配情况映射推荐等级：

| 等级 | score 阈值 | 含义 |
|:-----|:-----|:-----|
| `highly_recommended` | ≥ 0.6 且 stars ≥ 1000 | 命中精准、质量高、活跃维护 |
| `recommended` | ≥ 0.4 | 相关但稍弱 |
| `optional` | ≥ 0.2 | 仅供参考 |
| `not_recommended` | < 0.2 | 相关性低 |

### 权重设计思路（P0-2 重构后）

**基础分(1.0)— 项目质量与活跃度信号:**

| 指标 | 权重 | 为什么 |
|:-----|:----:|:-------|
| coverage | 0.4 | 描述命中查询词是最直接的相关性信号,权重最高避免高 star 但不相关项目霸榜 |
| stars | 0.25 | 社区认可度,次要信号(避免单凭 star 排序) |
| recency | 0.2 | 维护活跃度(连续衰减,无阶梯跳跃) |
| downloads | 0.1 | crates + npm(补充后)有,权重低避免偏袒包源 |
| license | 0.05 | 有 license 是基本要求,但不强求特定协议 |

**bonus(上限 0.5)— query 相关性加分:**

| 指标 | 上限 | 为什么 |
|:-----|:----:|:-------|
| descBonus | 0.15 | 描述命中 query 核心词的软加分 |
| nameBonus | 0.15 | name 命中权重高于 description(name 是项目本质) |
| phraseBonus | 0.1 | 精确短语匹配(如 "stepper motor" 命中) |
| topicsBonus | 0.1 | topics 命中(仓库标签 = 作者主动分类,信号强) |

> ⚠️ **P0-3 简化**：删除了 `activity`（原 0.2 权重），因为它和 `recency` 都基于 `lastUpdated`，存在重复计分。合并后统一用 `recency` 的连续衰减函数，避免阶梯式边界跳跃。
>
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

### 重试策略（P1-4 后）

> ⚠️ 一期**已实现自动重试**（P1-4 新增 `httpPost` + `withRetry`）：
>
> - 5xx 错误和网络错误：指数退避重试（默认 3 次,base 200ms）
> - 4xx 错误：不重试，直接抛 `HttpError`
> - 限流（429）：不重试（避免雪崩），抛 `RateLimitError` 由主流程降级处理
> - 适用于所有走 `httpGet`/`httpPost` 的源（含 P1-4 后的 Exa/Tavily）

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

findawheel 注册了五个工具：

**find_wheel**（主工具）：

```json
{
  "name": "find_wheel",
  "description": "Search for existing reusable wheels (open-source projects, npm/crates packages, APIs, CLI, SDK) BEFORE writing any new code. findawheel does NOT filter results by relevance — YOU must judge relevance yourself (e.g., reverse-intent 'remove watermark' results may appear; identify and skip them). WHEN TO CALL (mandatory triggers): user says 'I want to make/build/create/implement a ...' or describes a new feature/module/project/idea. WHY SEARCH FIRST: (1) avoid hallucinating non-existent libraries; (2) avoid outdated APIs; (3) avoid reinventing the wheel; (4) avoid picking the wrong library. WORKFLOW: suggest_queries → find_wheel → compare top 5 by stars/lastUpdated/description → recommend 2-3 with reasons → then code. HYBRID PRESENTATION: top 3 results include inline 'details' (README snippet, code examples, release, license check); results ranked 4-10 have 'hasDetails': true (call get_wheel_details to retrieve cached details).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {"type": "string"},
      "intent": {"type": "string", "enum": ["feature", "project", "auto"]},
      "ecosystem": {"type": "string"},
      "limit": {"type": "number"},
      "exclude": {
        "type": "array",
        "items": {"type": "string"},
        "description": "Wheel names to exclude (Phase 7). AI identifies irrelevant results in a previous call and passes their names here to filter them out without re-querying APIs."
      }
    },
    "required": ["query"]
  }
}
```

**suggest_queries**（辅助工具）：

```json
{
  "name": "suggest_queries",
  "description": "Generate 4 search-term variants (precise/action_oriented/fuzzy/concise) for a user's idea. WHY CALL THIS FIRST: small AI models often skip tool calls and hallucinate libraries; this tool forces a search-first mindset. WORKFLOW: (1) user describes idea → (2) call suggest_queries → (3) pick recommended variant → (4) call find_wheel → (5) compare top 5 → (6) recommend 2-3 to user. Call this before find_wheel when unsure how to construct the query.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {"type": "string"}
    },
    "required": ["query"]
  }
}
```

**get_wheel_details**（详情懒加载工具）：

```json
{
  "name": "get_wheel_details",
  "description": "Retrieve detailed information (README snippet, code examples, latest release, license compatibility) for a single wheel by name. Use AFTER find_wheel when a result had 'hasDetails': true (details were pre-fetched and cached, so this call is instant). Only works for GitHub-hosted wheels (owner/repo format).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "name": {"type": "string", "description": "Wheel name in owner/repo format (e.g., facebook/react)"}
    },
    "required": ["name"]
  }
}
```

**record_feedback**（反馈记录工具）：

```json
{
  "name": "record_feedback",
  "description": "Record user feedback on a wheel to improve future search ranking. Actions: like (boost), hide (demote), click (small boost). Persisted to ~/.findawheel/feedback/.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "name": {"type": "string", "description": "Wheel name in owner/repo format"},
      "action": {"type": "string", "enum": ["like", "hide", "click"]}
    },
    "required": ["name", "action"]
  }
}
```

**search_knowledge**（知识库搜索工具）：

```json
{
  "name": "search_knowledge",
  "description": "Search user's personal knowledge base (local Markdown notes: Obsidian vault, Logseq, plain .md folders). Returns documents whose title/path/tags/content match the query, with snippets and file:// URLs. WHEN TO CALL: user asks about internal docs/team wiki/personal notes. CONFIG: Requires FINDAWHEEL_KB_ENABLED=true and FINDAWHEEL_KB_ROOT=<path>.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {"type": "string", "description": "Search query in any language (Chinese/English). Will be split into keywords for matching."},
      "limit": {"type": "number", "description": "Max results (default 10, max 50)"}
    },
    "required": ["query"]
  }
}
```

#### 混合呈现（Hybrid Presentation）

`find_wheel` 返回结果时采用混合呈现策略，由 `enrichTopWheels()` 实现：

| 结果排名 | 字段 | 说明 |
|:-----|:-----|:-----|
| top 3 | `details: WheelDetails` | 内联完整详情（README 前 30 行 + 最多 2 个代码示例 + 最新 release + license 兼容性） |
| top 4-10 | `hasDetails: true` | 详情已预抓取并写入 `detailsCache`，AI 调 `get_wheel_details` 命中缓存秒回 |
| top 11+ | 无标记 | 需要时调 `get_wheel_details` 实时抓取 |
| 非 GitHub 源 | 无标记 | npm/PyPI 等无 README API，不支持详情抓取 |
| 预抓取失败 | 无标记 | 容错跳过，不阻断主搜索 |

`detailsCache` 与 `findWheelTool` 的搜索缓存共享同一目录（`~/.findawheel/cache/`），但 key 空间隔离：
- 搜索缓存 key：`sha1(query + intent + ecosystem + limit)`
- 详情缓存 key：`sha1("details:" + name)`（`detailsCacheKey()` 导出自 `getWheelDetailsTool`，供 `findWheelTool` 复用）

这样 `get_wheel_details` 能直接命中 `find_wheel` 预抓取写入的缓存，避免重复抓取 README 和 release。

#### 反馈加权（Feedback Weighting）

用户通过 `record_feedback` 记录的反馈持久化到 `~/.findawheel/feedback/`（独立目录，无 TTL），跨会话累积影响搜索排序。流程由 `feedbackStore` + `feedbackWeighter` + `findWheelTool.applyFeedback()` 协作完成：

1. **存储层**（`feedbackStore.ts`）：`recordFeedback(name, action)` 累加计数并写磁盘，`getAllFeedback()` 批量读取
2. **加权计算**（`feedbackWeighter.ts`）：`applyFeedbackScore(baseScore, feedback)` 按固定分值调整
3. **集成**（`findWheelTool.ts`）：`runSearch` → `applyFeedback` → `enrichTopWheels` → `cache.set`

| 动作 | 分值 | 累加上限 | 说明 |
|:-----|:-----|:-----|:-----|
| `like` | +0.2 | +1.0 | 正向反馈封顶防刷 |
| `click` | +0.05 | +0.3 | 小幅加分封顶 |
| `hide` | -0.5 | 无上限 | 强负面信号，扣分不封顶 |

`applyFeedbackToWheels(wheels, feedbackMap)` 批量处理：调整 `matchScore` → 填 `feedbackDelta` → 用 `gradeRecommendation` 重新分级 → 按 adjustedScore 降序重排。缓存存最终结果（含 feedback 调整），反馈变化等 TTL（1h）自然刷新。

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
| PyPI 独立搜索源（重复） | 已在 Phase 3.1 实现 |
| 多用户、鉴权、服务端托管 | 超出 MCP 服务定位 |
| 社区评论、收藏夹、Web UI | 非核心功能 |
| ML 评分调参 | 启发式权重已够用，精确排序是三期项 |
| 硬规则相关性过滤 | Phase 6 已删除——判断交给 AI 调用方（RAG 范式） |
| 领域特化配置表 | Phase 6 已删除 DOMAINS/GENERIC_WORDS/STARS_DENOMINATOR——统一处理 |

> ✅ **Phase 6 简化（RAG 范式）**：findawheel 重新定位为"AI 编程的上下文增强器"。检索器只负责召回，相关性判断交给 AI。删除了 isMissingCoreConcept / isReverseIntent 等硬过滤函数、6 领域配置表、embedded 4 处特殊逻辑。保留翻译表/同义词表/ACTION_VERBS/feedback 加权/详情预抓取/硬件 ecosystem 推荐等纯增益机制。585 测试全通过。

这些会在三期按需加入，见 [README 路线图](../README.md#-路线图)。

---

<div align="center">

## 📚 进一步阅读

| | 文档 | 描述 |
|:---:|:-----|:-----|
| 🏠 | [README](../README.md) | 项目总览 |
| 📖 | [使用指南](./USAGE.md) | 下载、安装、配置、使用 |
| 🌐 | [MCP 协议官网](https://modelcontextprotocol.io/) | 理解 MCP 协议本身 |

</div>

---

<div align="center">

<sub>本文档由 findawheel 项目维护</sub>

**[↑ 返回顶部](#️-findawheel-工作原理)**

</div>
