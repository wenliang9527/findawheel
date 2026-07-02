# findawheel 设计文档

- **日期**：2026-07-02
- **状态**：待审阅
- **作者**：brainstorming 产物

## 1. 背景与目标

### 1.1 痛点

AI 编程时代，每个人用 AI 写代码、做新项目，很多想法其实是别人已经实现过的，结果大家各自重新造一遍轮子，浪费时间。

### 1.2 核心价值

在准备动手实现一个新想法之前，先在网上搜索，**找到已经存在、可以直接拿来用的轮子**（开源库 / 工具 / 现成项目 / SDK / API 等），让用户能复用而不是重写。

### 1.3 形态

一个 **MCP 服务**，集成到 Trae / Cursor / Claude Desktop 等 AI 编程环境。用户在和 AI 对话描述想法时，AI 自动调用它去搜轮子，并直接在对话里给出推荐。在"实现新想法"这个动作前面加一步——先搜，再决定是"用现成的"还是"自己写"。

## 2. 关键决策

| # | 维度 | 决定 |
|---|------|------|
| 1 | 形态 | MCP 服务，集成到 Trae/Cursor 等，AI 对话时自动触发 |
| 2 | 轮子范围 | 任何可复用的东西（开源项目 + 包/库 + API 服务 + CLI 工具 + SDK） |
| 3 | 输入粒度 | 功能级 + 项目级都支持，工具自己判断 query 粒度 |
| 4 | 输出深度 | 检索 + 指标（stars / 最近更新 / 活跃度 / license / 是否归档等） |
| 5 | 使用范围 | 个人用 + 可开源 |
| 6 | 技术栈 | TypeScript / Node.js（官方 MCP SDK） |
| 7 | 数据源策略 | 方案 C：分层渐进。一期 GitHub + 包管理器免费源，二期加 Web 搜索 |

## 3. 整体架构

### 3.1 架构概述

stdio MCP 服务，对调用方 AI 暴露一个主 tool `find_wheel`。服务内部用"数据源 adapter"模式组织——每个数据源是一个 adapter，统一输出归一化的 `Wheel` 结构。二期加 Web 搜索源时只需新增 adapter，不动主流程。

### 3.2 核心组件

每个组件职责单一、可独立测试：

- `McpServer` — MCP 服务入口，注册 tool、处理协议（基于 `@modelcontextprotocol/sdk`）
- `findWheelTool` — 暴露给 AI 的主 tool，接收 query，返回 `Wheel[]`
- `QueryClassifier` — 判断 query 是"功能级"还是"项目级"（关键词启发式），决定主搜哪个源、排序策略
- `SourceAdapter` 接口 — 统一数据源抽象：`search(query, opts) → RawResult[]`
  - `GitHubSourceAdapter`（一期）— 调 GitHub Search API 搜仓库
  - `RegistrySourceAdapter`（一期）— 调包管理器 registry（npm/crates）搜包
  - `WebSearchSourceAdapter`（二期）— 调 Exa/Brave 等
- `Normalizer` — 把不同源的 `RawResult` 归一化为统一的 `Wheel`
- `MetricsEnricher` — 补/对齐指标（stars、最近更新、license、archived、活跃度）
- `Ranker` — 按质量分排序、过滤明显不靠谱的（archived、长期不更新）

### 3.3 归一化 Wheel 结构

跨源统一，这是整个系统能多源聚合的关键：

```ts
interface Wheel {
  name: string;            // 仓库名 / 包名 / 服务名
  source: 'github' | 'npm' | 'pypi' | 'crates' | 'web';
  url: string;             // 主页/仓库链接
  description: string;     // 简短描述
  type: 'project' | 'package' | 'api' | 'cli' | 'sdk';
  metrics: {
    stars?: number;
    lastUpdated?: string;  // ISO date
    license?: string;
    archived?: boolean;
    downloads?: number;    // 包用，仓库无
    activity?: 'high' | 'medium' | 'low';
  };
}
```

## 4. MCP Tool 接口契约

### 4.1 Tool 注册信息

```ts
{
  name: "find_wheel",
  description: "Search for existing reusable wheels (open-source projects, packages, APIs, CLIs, SDKs) for a feature or project idea. Call this BEFORE implementing a new idea to avoid reinventing the wheel.",
  inputSchema: { /* 见 4.2 */ }
}
```

### 4.2 输入参数

```ts
interface FindWheelInput {
  query: string;          // 必填。功能描述或项目想法，自然语言
  intent?: 'feature' | 'project' | 'auto';  // 可选，默认 'auto'
  ecosystem?: string;     // 可选，技术栈偏好，如 'js'/'python'/'rust'
  limit?: number;         // 可选，返回上限，默认 10
}
```

设计要点：
- `query` 是自然语言，AI 直接把对话里的想法描述传进来，工具内部自己构造搜索语法
- `intent` 默认 `auto`，让 `QueryClassifier` 自动判；AI 也可显式指定，绕过分类
- `ecosystem` 可选——AI 若已知当前项目技术栈可传入，用于过滤包管理器源（一期不强制）
- `limit` 默认 10，避免结果过载

### 4.3 输出

MCP tool result 是 content 数组，放一个 JSON text item：

```ts
{
  content: [{
    type: "text",
    text: JSON.stringify({
      query: string;            // 回显原 query
      intent: 'feature' | 'project';  // 实际使用的意图
      total: number;            // 原始命中数（去重前）
      wheels: Wheel[];          // 归一化 + 排序后的结果
      degradedSources?: string[]; // 降级的数据源
    })
  }]
}
```

调用方 AI 拿到 JSON 后，自己负责：解读每个 wheel 的指标 → 结合对话上下文 → 用自然语言推荐给用户。**工具不替 AI 写文案，只给结构化数据**——这是 MCP 模式的正确分工。

### 4.4 错误返回

- 数据源 API 失败（限流/网络）→ `isError: true`，content 里说明哪个源失败
- query 为空 → `isError: true`，提示必填
- 部分源失败但其他源有结果 → 正常返回，在结果里附 `degradedSources` 字段说明降级

### 4.5 主流程时序

```
AI 调用 find_wheel(query)
  → findWheelTool.handle(input)
    → QueryClassifier.classify(query, intent)        // 定意图
    → SourceAdapter[] 选源（按 intent + ecosystem）
    → 并行调各 adapter.search()
    → Normalizer 归一化
    → 去重（按 url/name）
    → MetricsEnricher 对齐指标
    → Ranker 排序 + 过滤
    → 截取 limit 条
  ← 返回 { wheels, total, intent, query }
```

## 5. 数据源 Adapter 详解（一期）

### 5.1 GitHubSourceAdapter

**搜索语法**：用 GitHub Search API（`/search/repositories`），从自然语言 query 构造搜索表达式。
- 提取 query 里的关键词，组合成 `q`：例如 `"markdown to pdf" in:name,description,readme sort:stars`
- `intent=project` → 不加 `in:readme`，侧重 name/description，让大项目浮上来
- `intent=feature` → 加 `in:readme`，更细粒度匹配功能
- 按需加 `language:` 过滤（当 `ecosystem` 指定时，如 `js`→`language:JavaScript`）

**请求参数**：
```ts
GET /search/repositories?q=...&sort=stars&order=desc&per_page=20
// Accept: application/vnd.github+json
```
取前 20，让 Ranker 后续精选。

**鉴权**：可选 `GITHUB_TOKEN` 环境变量。
- 无 token：60 次/小时（个人开发够用，但限流明显）
- 有 token：5000 次/小时（推荐，文档里写明怎么配）
- 不强制要求 token，保证零配置能跑

**限流处理**：
- 解析响应头 `X-RateLimit-Remaining` / `X-RateLimit-Reset`
- 接近限流（<5 次）时记日志
- 命中限流 → 抛 `RateLimitError`，由主流程降级处理

**返回的 RawResult 字段**（从 GitHub item 映射）：
```ts
{
  source: 'github',
  name: item.full_name,           // "owner/repo"
  url: item.html_url,
  description: item.description ?? '',
  stars: item.stargazers_count,
  language: item.language,
  license: item.license?.spdx_id,  // 'MIT' / 'Apache-2.0' / null
  archived: item.archived,
  pushedAt: item.pushed_at,        // 最近推送，作为 lastUpdated
  topics: item.topics ?? [],
}
```

### 5.2 RegistrySourceAdapter

**多 registry 聚合**：内部按 `ecosystem` 选一个或多个 registry 子源，并行查。

| ecosystem | registry | 端点 |
|-----------|----------|------|
| `js` | npm | `https://registry.npmjs.org/-/v1/search?text=...&size=20` |
| `python` | PyPI | 无搜索 API（一期不查，由 GitHub 兜底） |
| `rust` | crates.io | `https://crates.io/api/v1/crates?q=...&per_page=20` |

**PyPI 的取舍**：PyPI 官方没有搜索 API。一期处理方式：
- 若 `ecosystem=python`，**不查 PyPI**，而是让 GitHubSourceAdapter 兜底（Python 包大多在 GitHub 上有镜像仓库）
- 二期接 Web 搜索源后，PyPI 的覆盖由 Web 搜索补上
- 一期不做 PyPI scraping——不稳定、易被封、价值有限

**npm 搜索结果字段**：
```ts
// registry.npmjs.org 返回的 package 对象
{
  source: 'npm',
  name: pkg.name,
  url: `https://www.npmjs.com/package/${pkg.name}`,
  description: pkg.description ?? '',
  version: pkg.version,
  keywords: pkg.keywords ?? [],
  links: pkg.links,               // {npm, repository, homepage}
  publisher: pkg.publisher,
  date: pkg.date,                  // 最近发布时间，作为 lastUpdated
}
```

npm 搜索 API **不直接返回下载量**。下载量需另调 `https://api.npmjs.org/downloads/point/last-week/<pkg>`。一期取舍：
- **不调下载量 API**（避免每次多打一倍请求、易限流）
- `downloads` 字段留空，由 Ranker 不依赖它排序
- 二期若需要可加批量下载量查询 + 缓存

**crates.io 字段**：直接返回 downloads、recent_downloads，指标最全。

**鉴权/限流**：npm/crates.io 公开搜索无需 token。遵守 `User-Agent`（crates.io 要求），合理间隔。

### 5.3 跨源归一化（Normalizer 职责边界）

各源 RawResult 字段不同，Normalizer 统一映射成 `Wheel`：
- `type` 推断：GitHub 仓库默认 `project`，但若 `topics` 含 `cli`/`sdk`/`api` 则覆盖；npm/crates 一律 `package`
- `metrics.stars`：仅 GitHub 有；包源留 `undefined`
- `metrics.downloads`：仅 crates 有（一期）
- `metrics.lastUpdated`：GitHub 用 `pushedAt`，npm 用 `date`，crates 用 `updated_at`
- `metrics.license`：GitHub 用 `license.spdx_id`，npm 需另查包元数据（一期留空），crates 用 `license` 字段

### 5.4 一期不做的事（YAGNI）

- 不调 npm 下载量 API
- 不做 PyPI 搜索
- 不抓 README / 示例代码
- 不缓存（一期流量低，每次实时查够用；二期再加）

## 6. QueryClassifier、Ranker 与错误降级

### 6.1 QueryClassifier

**职责**：判断 query 是 `feature` 还是 `project`，决定主搜哪个源、排序策略。

**实现方式（一期）**：关键词启发式，不上 LLM。

```ts
function classify(query: string, hint?: 'feature' | 'project' | 'auto'): 'feature' | 'project' {
  if (hint && hint !== 'auto') return hint;  // AI 显式指定则直接用

  // project 级信号词：描述"产品/应用"形态
  const projectSignals = ['app', 'application', 'platform', 'tool', 'editor',
    'dashboard', '系统', '平台', '应用', '编辑器', '网站', '管理系统'];
  // feature 级信号词：描述"一个功能/能力"
  const featureSignals = ['parse', 'convert', 'generate', 'compress', 'encrypt',
    'client', 'sdk', 'wrapper', '解析', '转换', '压缩', '加密', '客户端'];

  const lower = query.toLowerCase();
  const projectScore = projectSignals.filter(w => lower.includes(w)).length;
  const featureScore = featureSignals.filter(w => lower.includes(w)).length;

  if (projectScore > featureScore) return 'project';
  if (featureScore > projectScore) return 'feature';
  return 'project';  // 默认 project，更安全（大项目也常含小功能）
}
```

**意图对搜索的影响**：

| 意图 | 主源 | GitHub 搜索 | 排序侧重 |
|------|------|------------|----------|
| `feature` | npm/crates 优先，GitHub 次之 | 加 `in:readme`，细粒度 | 下载量/最近更新优先（活跃的包） |
| `project` | GitHub 优先，npm/crates 次之 | 侧重 name/description | stars 优先（社区认可度） |

### 6.2 Ranker

**职责**：对归一化后的 `Wheel[]` 排序 + 过滤。

**过滤规则**（硬过滤，直接剔除）：
- `archived === true`（GitHub 归档仓库，已停止维护）
- `lastUpdated` 距今 > 3 年（明显废弃）
- `description` 为空且 `stars < 10`（信息不足，难以判断）

**排序分（软评分，加权求和）**：

```ts
function score(wheel: Wheel, intent: 'feature' | 'project'): number {
  const s = {
    stars:   normalize(wheel.metrics.stars, 0, 50000) * 0.3,   // 归一化到 [0,1]
    recency: recencyScore(wheel.metrics.lastUpdated) * 0.3,    // 越近越高
    activity: activityScore(wheel.metrics.activity) * 0.2,
    downloads: normalize(wheel.metrics.downloads, 0, 100000) * 0.1,
    license: hasLicense(wheel) ? 0.1 : 0,                      // 有 license 加分
  };
  // intent 调整：feature 级把 downloads 权重调高、stars 调低
  if (intent === 'feature') {
    s.stars *= 0.7; s.downloads *= 1.5;
  }
  return Object.values(s).reduce((a, b) => a + b, 0);
}
```

- `recencyScore`：1 年内=1.0，1-2 年=0.7，2-3 年=0.4
- `activityScore`：有 `lastUpdated` 且 < 6 个月 = high=1.0，否则 medium=0.5/low=0.2

**MVP 简化声明**：评分公式一期用启发式权重，不做机器学习/调参。能跑出"明显的垃圾在后、明显的好货在前"就达标。精确排序是后期增强。

### 6.3 去重

按 `name`（小写）+ `url` 去重。例如 `lodash` 在 npm 和 GitHub 都命中，保留指标更全的那个。**一期简化**：相同 `name` 直接合并指标，保留第一出现的 `url`。

### 6.4 错误降级策略

主流程把数据源调用包在 try/catch，按"部分成功优于全失败"原则：

| 场景 | 行为 |
|------|------|
| 单个 adapter 抛错（网络/限流/解析失败） | 跳过该源，其他源正常返回，结果附 `degradedSources: ['github']` |
| 所有 adapter 全失败 | 返回 `isError: true`，content 说明"所有数据源暂不可用" |
| query 为空 | `isError: true`，提示 `query` 必填 |
| 单源返回 0 结果 | 不算错，正常聚合（可能其他源有结果） |
| 全部源 0 结果 | 正常返回空 `wheels: []`，不报错 |

**降级时不重试**：一期不实现自动重试（避免雪崩），失败即降级。二期可加指数退避重试。

## 7. 项目结构、配置与依赖

### 7.1 项目结构

```
findawheel/
├── src/
│   ├── index.ts                    # 入口：启动 MCP 服务
│   ├── server.ts                   # McpServer 封装、tool 注册
│   ├── tools/
│   │   └── findWheelTool.ts        # 主 tool 的 handle 逻辑、编排各组件
│   ├── classifier/
│   │   └── queryClassifier.ts      # 意图分类
│   ├── sources/                    # 数据源 adapter
│   │   ├── sourceAdapter.ts        # 接口定义 + 类型
│   │   ├── githubSourceAdapter.ts
│   │   └── registrySourceAdapter.ts # 内含 npm/crates 子源
│   ├── normalize/
│   │   ├── normalizer.ts           # RawResult → Wheel
│   │   └── types.ts                # Wheel / RawResult 类型
│   ├── enrich/
│   │   └── metricsEnricher.ts      # 指标对齐
│   ├── rank/
│   │   └── ranker.ts               # 排序 + 过滤
│   ├── util/
│   │   ├── http.ts                 # fetch 封装（超时、UA、错误归一化）
│   │   └── env.ts                  # 环境变量读取
│   └── errors.ts                   # 自定义错误类型（RateLimitError 等）
├── tests/                          # 单元测试，镜像 src 结构
│   ├── tools/findWheelTool.test.ts
│   ├── classifier/...
│   └── ...
├── package.json
├── tsconfig.json
├── .gitignore
├── .env.example                    # 环境变量示例（不含真实值）
└── README.md                       # 安装、配置、如何在 Trae/Cursor 接入
```

**结构原则**：
- 每个核心组件一个文件，文件名 = 职责，可独立测试
- `sources/` 用 adapter 模式，二期加 `webSearchSourceAdapter.ts` 不动其他文件
- `util/http.ts` 统一出口，所有外部请求走它（便于 mock、统一 UA/超时）

### 7.2 依赖清单（一期）

**运行时依赖**（保持精简）：
```json
{
  "@modelcontextprotocol/sdk": "^1.x",
  "zod": "^3.x"
}
```
- HTTP 用 Node 18+ 内置 `fetch`，不引入 axios/node-fetch
- 不引入 MCP server 以外的框架

**开发依赖**：
```json
{
  "typescript": "^5.x",
  "vitest": "^1.x",
  "@types/node": "^20.x"
}
```

### 7.3 配置（环境变量）

通过环境变量配置，零默认 key 也能跑：

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `GITHUB_TOKEN` | 否 | 无 | 提升 GitHub API 限流到 5000/h；无则 60/h |
| `FINDAWHEEL_LIMIT` | 否 | 10 | 默认返回上限 |
| `FINDAWHEEL_TIMEOUT_MS` | 否 | 8000 | 单源请求超时 |
| `FINDAWHEEL_LOG_LEVEL` | 否 | `info` | `error`/`warn`/`info`/`debug` |

- 所有配置读 `process.env`，集中在 `util/env.ts`，带默认值
- `.env.example` 列出所有变量 + 注释，`.gitignore` 排除 `.env`
- 不做配置文件（JSON/YAML），环境变量足够

### 7.4 接入说明（README 会写）

1. `git clone` + `npm install` + `npm run build`
2. 在 Trae/Cursor 的 MCP 配置里加：
   ```json
   {
     "mcpServers": {
       "findawheel": {
         "command": "node",
         "args": ["/path/to/findawheel/dist/index.js"],
         "env": { "GITHUB_TOKEN": "可选" }
       }
     }
   }
   ```
3. 重启 IDE，AI 对话里描述想法时会自动调用 `find_wheel`

### 7.5 构建与测试

- `npm run build` → `tsc` 编译到 `dist/`
- `npm test` → `vitest run`
- `npm run dev` → `tsc --watch` 便于迭代
- 目标 Node 18+（用内置 fetch 和原生 ESM 支持）

## 8. 测试策略

### 8.1 分层测试

重单元轻集成：

| 层级 | 范围 | 方式 | 优先级 |
|------|------|------|--------|
| 单元测试 | 各核心组件 | vitest，纯函数/mocked 依赖 | 高（一期重点） |
| 集成测试 | `findWheelTool` 主流程 | mock 所有 adapter，验证编排逻辑 | 中 |
| 真实 API 测试 | adapter 实调 | 单独脚本，CI 默认跳过，本地手动 | 低 |

### 8.2 单元测试覆盖目标

- `queryClassifier`：功能/项目信号词命中、`auto` 默认、显式 hint 覆盖
- `normalizer`：各源 RawResult → `Wheel` 字段映射正确，缺失字段安全降级
- `metricsEnricher`：跨源指标对齐、`activity` 推断
- `ranker`：过滤规则（archived/3年/空描述）、排序分计算、intent 权重调整、去重合并
- `githubSourceAdapter`：query → 搜索语法构造（mock fetch 验证 URL）
- `registrySourceAdapter`：npm/crates 请求构造、响应解析

### 8.3 集成测试用例

- 多源并行 → 归一化 → 去重 → 排序的端到端编排正确
- 单源失败 → 降级返回 + `degradedSources` 标注
- 全源失败 → `isError: true`
- 空 query → `isError: true`
- 0 结果 → 正常返回空数组

### 8.4 不测的

真实 GitHub/npm API 响应放本地手动脚本 `scripts/manual-check.ts`。

## 9. 成功标准（MVP 完成定义）

一期 MVP 视为完成，当且仅当：

1. **功能可用**：在 Trae 里接入后，对话描述想法时 AI 能成功调用 `find_wheel` 并拿到结构化结果
2. **覆盖达标**：GitHub + npm + crates 三个源都能返回真实结果
3. **质量合格**：对 5 个典型 query 的返回结果里，前 3 条是"明显相关且非废弃"的项目
4. **降级可靠**：单源失败时其他源仍返回结果，不整个报错
5. **零配置可跑**：不设任何环境变量也能启动并返回结果（GitHub 60/h 限流可接受）
6. **测试通过**：`npm test` 全绿，单元测试覆盖核心组件
7. **可接入**：README 写清接入步骤，按文档操作能跑通

### 9.1 典型 query 验证集

- `feature` 级：`"markdown 转 pdf"`、`"JWT 验证"`、`"图片压缩"`
- `project` 级：`"类 Notion 的笔记应用"`、`"markdown 编辑器"`

## 10. 二期演进路径

明确边界，不在一期做：

| 增强项 | 价值 | 触发条件 |
|--------|------|----------|
| Web 搜索源（Exa/Brave） | 补非 GitHub 托管的轮子（API 服务、博客方案） | 一期验证好用了、且发现 GitHub/npm 覆盖不够 |
| 缓存层（TTL 内存缓存） | 降限流、提速 | 流量上升、重复 query 多 |
| npm 下载量 + README 摘要 | 更丰富指标、更精准推荐 | 排序质量不够、需更深信号 |
| 指数退避重试 | 抗限流抖动 | 偶发限流影响体验 |
| PyPI 搜索 | Python 包覆盖 | Python 生态用户反馈 |
| 评分公式调参/学习 | 精确排序 | 启发式排序明显不够好 |

### 10.1 一期明确不做（YAGNI 边界）

多用户、鉴权、服务端托管、社区评论/评分、收藏夹、Web UI。
