<div align="center">

# 🔍 findawheel

### AI 时代的"找轮子"助手

> 在动手写代码前，先帮你找到已经造好的轮子。

[![Language](https://img.shields.io/badge/lang-English-blue.svg?style=flat-square)](./README.en.md)
[![Node](https://img.shields.io/badge/Node.js-≥18-green.svg?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-1.29-orange.svg?style=flat-square)](https://modelcontextprotocol.io/)
[![Build](https://img.shields.io/badge/build-passing-brightgreen.svg?style=flat-square)](./)
[![Tests](https://img.shields.io/badge/tests-506%2F506-brightgreen.svg?style=flat-square)](./)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](./LICENSE)

</div>

---

## 📖 目录

| | 章节 | 描述 |
|:---:|:-----|:-----|
| 🎯 | [项目简介](#-项目简介) | findawheel 是什么 |
| 🤔 | [为什么需要它](#-为什么需要它) | 解决什么问题 |
| ✨ | [核心特性](#-核心特性) | 六大能力一览 |
| 🚀 | [快速开始](#-快速开始) | 三步上手 |
| 🤖 | [接入 AI 客户端](#-接入-ai-客户端) | Trae / Cursor / Claude |
| 🔧 | [环境变量](#-环境变量) | 配置项说明 |
| 🏗️ | [项目架构](#-项目架构) | 数据流图 |
| 🛠️ | [开发指南](#-开发指南) | 命令速查 |
| 🌐 | [数据源](#-数据源) | 一期覆盖范围 |
| 🗺️ | [路线图](#-路线图) | 演进规划 |
| 📚 | [深入阅读](#-深入阅读) | 详细文档链接 |

---

## 🎯 项目简介

`findawheel` 是一个基于 [MCP（Model Context Protocol）](https://modelcontextprotocol.io/) 的服务。它能在你准备实现一个新想法时，自动搜索互联网上已有的可复用"轮子"——包括开源项目、npm/crates 包、API、CLI 工具、SDK 等——让你避免重复造轮子。

> 💡 **RAG 范式定位**
>
> findawheel 是 AI 编程的"上下文增强器"：**检索器只负责召回，判断权交给 AI**。
> AI 客户端在实现新功能/新模块/新想法前必须先调用 `find_wheel` 拿到候选轮子，再决定是直接复用、参考实现还是从头自研。findawheel 不做硬性相关性过滤——主流库 Neutree/COMTool 等不会被规则误杀，AI 拿到 stars/description/lastUpdated 原值后自行判断。

> 💡 **使用场景**
>
> 当你对 AI 说"我想做一个 Markdown 转 PDF 的工具"时，AI 会先调用 `findawheel` 搜索已有的实现，再决定是否推荐你直接使用。

---

## 🤔 为什么需要它

AI 编程时代，每个人都可以快速产生想法并动手实现。但问题是：**很多"新想法"其实别人已经做过了**。结果是大量时间被浪费在重复造轮子上。

`findawheel` 在"开始实现"之前增加一个步骤：

```
 ┌──────────┐      ┌──────────────┐      ┌─────────────────┐
 │  产生想法  │ ──→ │ 搜索现有轮子   │ ──→ │ 复用 or 自研     │
 └──────────┘      └──────────────┘      └─────────────────┘
```

---

## ✨ 核心特性

| 图标 | 特性 | 说明 |
|:---:|:-----|:-----|
| 🔎 | **多源搜索** | 同时搜索 GitHub、Gitee、npm、crates.io、Web（Exa+Tavily） |
| 🧠 | **意图识别** | 自动判断 query 是"功能级"还是"项目级"，拆分核心词/修饰词/格式词 |
| 📊 | **统一归一** | 不同来源的结果统一成 `Wheel` 结构，带推荐等级和理由 |
| 🏆 | **软排序信号** | 相关度 + stars + 活跃度 + 下载量 + license + 描述匹配度；**不做硬过滤**，相关性判断交给 AI |
| 🛡️ | **基础过滤** | 仅剔除归档/废弃/聚合仓库（awesome-lists）；反向意图/核心词缺失等由 AI 自行识别 |
| ⚡ | **失败降级** | 单源失败不影响其他源；Web 源 Exa 失败自动 fallback Tavily |
| 🌏 | **中文友好** | 50+ 词的中英翻译表，中文 query 自动转英文搜索 |
| 📝 | **RAG 工作流** | 工具描述明确"WHEN TO CALL / WHY SEARCH FIRST"，AI 必须先搜索再编码 |

---

## 🚀 快速开始

```bash
# 1. 克隆项目
git clone <repo-url> findawheel
cd findawheel

# 2. 安装依赖
npm install

# 3. 构建
npm run build
```

> 📖 完整安装与配置步骤见 [使用指南](./docs/USAGE.md)

---

## 🤖 接入 AI 客户端

在 Trae / Cursor / Claude Desktop 等支持 MCP 的客户端配置中添加：

```json
{
  "mcpServers": {
    "findawheel": {
      "command": "node",
      "args": ["/absolute/path/to/findawheel/dist/index.js"],
      "env": {
        "GITHUB_TOKEN": "可选，但强烈建议配置",
        "EXA_API_KEY": "可选，启用 Web 神经搜索（主源）",
        "TAVILY_API_KEY": "可选，Web 搜索兜底",
        "GITLAB_TOKEN": "可选，提升 GitLab 限流",
        "GITEE_TOKEN": "可选，提升 Gitee 限流",
        "LIBRARIES_IO_API_KEY": "可选，启用 30+ 包管理器搜索"
      }
    }
  }
}
```

重启客户端后，在对话中描述你的想法，AI 会自动调用 `find_wheel` 并推荐可复用的轮子。

---

## 🔧 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|:-----|:---:|:------:|:-----|
| `GITHUB_TOKEN` | 否 | — | GitHub PAT。未配置时限流 60 次/小时，配置后 5000 次/小时。 |
| `EXA_API_KEY` | 否 | — | Exa API key，启用 Web 神经网络搜索（主源）。[获取](https://exa.ai) |
| `TAVILY_API_KEY` | 否 | — | Tavily API key，Web 搜索兜底（Exa 失败/额度耗尽时使用）。[获取](https://tavily.com) |
| `GITLAB_TOKEN` | 否 | — | GitLab token（可选，提升 GitLab 搜索限流，匿名也可搜）。 |
| `GITEE_TOKEN` | 否 | — | Gitee token（可选，提升 Gitee 搜索限流：匿名 60/hour，认证 5000/hour，匿名也可搜）。[获取](https://gitee.com/profile/personal_access_tokens) |
| `LIBRARIES_IO_API_KEY` | 否 | — | Libraries.io API key，启用多包管理器搜索（覆盖 npm/pypi/rubygems/cargo/maven 等 30+ 平台）。[获取](https://libraries.io/account) |
| `FINDAWHEEL_USER_LICENSE` | 否 | — | 你的项目 license（如 `MIT`/`Apache-2.0`/`GPL-3.0`）。配置后，搜索结果的详情里会包含 `licenseCheck` 字段，标注每个轮子的 license 是否与你的项目兼容（避免 license 传染）。 |
| `FINDAWHEEL_CACHE_ENABLED` | 否 | `true` | 是否启用本地缓存（`~/.findawheel/cache/`）。设为 `false` 可禁用。 |
| `FINDAWHEEL_FEEDBACK_DIR` | 否 | `~/.findawheel/feedback/` | 反馈存储目录。持久化用户对 wheel 的 like/hide/click 反馈，跨会话累积影响排序。无 TTL，手动清理即可。 |
| `FINDAWHEEL_CACHE_TTL_MS` | 否 | `3600000` | 缓存 TTL（毫秒），默认 1 小时。 |
| `FINDAWHEEL_LIMIT` | 否 | `20` | 默认返回结果数量。 |
| `FINDAWHEEL_TIMEOUT_MS` | 否 | `8000` | 单源请求超时（毫秒）。 |
| `FINDAWHEEL_LOG_LEVEL` | 否 | `info` | 日志级别：`error` \| `warn` \| `info` \| `debug`。 |
| `FINDAWHEEL_KB_ENABLED` | 否 | `false` | 是否启用 `search_knowledge` 工具（搜索本地 Markdown 知识库）。设为 `true` 后还需配置 `FINDAWHEEL_KB_ROOT`。详见 [USAGE.md 3.6 节](./docs/USAGE.md)。 |
| `FINDAWHEEL_KB_ROOT` | 否 | — | 知识库根目录（逗号分隔多个 vault）。如 `/path/to/obsidian-vault` 或 `D:\notes,D:\docs`。仅当 `FINDAWHEEL_KB_ENABLED=true` 时生效。 |
| `FINDAWHEEL_KB_MAX_FILE_KB` | 否 | `100` | 知识库单文件大小上限（KB），超过则跳过不扫描，避免大文件拖慢搜索。 |
| `FINDAWHEEL_KB_CACHE_ENABLED` | 否 | `false` | 是否启用知识库搜索缓存（与 `find_wheel` 共享 `cacheDir` 但 key 空间隔离，前缀 `kb:`）。设为 `true` 后 TTL 同 `FINDAWHEEL_CACHE_TTL_MS`。 |

---

## 🏗️ 项目架构

```
              AI 调用 find_wheel(query) 或 suggest_queries(query)
                            │
                            ▼
                  ┌─────────────────────┐
                  │  QueryParser        │  ← 拆分核心词/修饰词/格式词(无反义词)
                  │  + QueryClassifier  │  ← 判断 feature / project
                  └─────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │ 主搜索        │ │ 副搜索        │ │              │
    │ (精准 query)  │ │ (同义词泛化)  │ │              │
    └──────┬───────┘ └──────┬───────┘ │              │
           └────────┬───────┘         │              │
                    ▼                 │              │
    ┌─────────────────────────────────────────────┐  │
    │  GitHub · Gitee · npm · crates · GitLab · PyPI · Libraries.io · GitHub Code · VS Code Market · Papers with Code · HuggingFace · Web    │  │
    │     (Exa 主 + Tavily 兜底)                  │  │
    └─────────────────────┬───────────────────────┘  │
                          ▼                          │
            ┌──────────────────────────────────┐    │
            │  Normalizer → MetricsEnricher    │    │
            │  → Recommender → Ranker          │    │
            │  (归一化+指标+推荐等级+软排序)     │    │
            └──────────────────────────────────┘    │
                          ▼                          │
                  Wheel[] + summary 返回给 AI ───────┘
                            │
                            ▼
            AI 自行判断相关性,选最适合的 2-3 个推荐
            (findawheel 不做硬过滤,判断权在 AI)
```

> 📖 完整工作原理见 [工作原理文档](./docs/HOW_IT_WORKS.md)

---

## 🛠️ 开发指南

| 命令 | 作用 |
|:-----|:-----|
| `npm run dev` | tsc --watch 热编译 |
| `npm test` | 运行所有测试 |
| `npm run test:watch` | 监听模式运行测试 |
| `npm run build` | 构建到 dist/ |

---

## 🌐 数据源

| 数据源 | 类型 | 需要 token | 说明 |
|:------|:-----|:-----|:-----|
| **GitHub** | 开源仓库 | 可选 | `/search/repositories`，支持引号短语精确匹配（单词不加引号、多词加引号） |
| **Gitee** | 国内开源仓库 | 不需要 | 补充国内项目，访问速度快 |
| **npm** | JavaScript 包 | 不需要 | 自动补充 stars + 周下载量 |
| **crates.io** | Rust 包 | 不需要 | 返回 downloads，指标最全 |
| **Web (Exa)** | 网页/教程/工具站 | 需要 API key | 神经网络搜索，对代码语义友好（主源） |
| **Web (Tavily)** | 网页/教程/工具站 | 需要 API key | Exa 失败/额度耗尽时自动 fallback |
| **GitLab** | 开源仓库 | 可选 | `/api/v4/projects`，补充非 GitHub 托管的项目 |
| **PyPI** | Python 包 | 不需要 | 解析 `pypi.org/search` HTML，无 stars/downloads 数据 |
| **Libraries.io** | 多平台包 | 需要 API key | 一次查询覆盖 30+ 包管理器（npm/pypi/cargo/maven...） |
| **GitHub Code** | 代码片段 | 复用 `GITHUB_TOKEN` | `/search/code`，搜代码片段而非仓库；强制认证，10 req/min 限流；命中文件返回 `textFragment` 代码片段 |
| **VS Code Marketplace** | IDE 扩展 | 不需要 | `extensionquery` POST API，搜 VS Code 插件；返回安装数/评分；非官方文档化 API |
| **Papers with Code** | 论文/算法 | 不需要 | `/api/v1/papers/`，搜论文与算法实现；返回标题/摘要/年份/arxiv 链接；补算法盲区 |
| **HuggingFace Hub** | AI 模型 | 不需要 | `/api/models?search=...`，搜 pretrained model；返回点赞数/下载数/任务类型；补 AI 模型盲区 |

> ℹ️ **PyPI 策略**：PyPI 无官方搜索 JSON API，通过解析 `pypi.org/search` 的 HTML 提取包信息，无 stars/downloads 数据。
>
> ℹ️ **零配置 Web 搜索**：如果不想申请 Exa/Tavily key，可并启 [Open-WebSearch MCP](https://github.com/OpenWebSearch) 作为补充，AI 会自动编排。

---

## 🛠️ 提供的工具

| 工具 | 用途 | 何时调用 |
|:-----|:-----|:-----|
| `find_wheel` | 搜索现成轮子 | **强制触发**：用户说"我想做/建/创建/实现一个..."时**第一动作**调用，先搜索再编码（RAG 范式）。支持 `exclude` 参数二次筛选不相关项目 |
| `suggest_queries` | 生成 4 个搜索词建议 | AI 不确定怎么构造搜索词时调用，拿到精准/动作导向/模糊/简洁 4 个角度的建议 |
| `get_wheel_details` | 拉取单个轮子的详情 | `find_wheel` 结果里带 `hasDetails: true` 标记时，按需调用拿到 README 摘要、代码示例、最新 release、license 兼容性 |
| `record_feedback` | 记录用户反馈 | AI 展示结果后，根据用户反应调用：点赞→`like`、说不相关→`hide`、点开链接→`click`。反馈持久化累积，影响后续搜索排序 |
| `search_knowledge` | 搜索本地 Markdown 知识库 | 用户问"团队文档/个人笔记/内部规范"时调用，搜索 Obsidian vault / Logseq / 任意 `.md` 文件夹。需配置 `FINDAWHEEL_KB_ENABLED=true` + `FINDAWHEEL_KB_ROOT=<path>` 才启用（默认关闭）。详见 [USAGE.md 3.6 节](./docs/USAGE.md#36-配置个人知识库可选启用-search_knowledge-工具) |

> 💡 **RAG 工作流（工具描述中明确）**
>
> `find_wheel` 和 `suggest_queries` 的描述字段加入了结构化提示词：
> - **WHEN TO CALL**：新功能/新模块/新项目/新想法触发词出现时必须先调用
> - **WHY SEARCH FIRST**：4 种 AI 失败模式（幻觉库 / 过时 API / 重新发明轮子 / 选错库）
> - **WORKFLOW**：suggest_queries → find_wheel → 对比 top 5 推荐 2-3 个 → 编码
> - **关键声明**：findawheel **不做相关性硬过滤**，AI 必须自行识别不相关结果（如反向意图"remove watermark"）

### 混合呈现（结果信息丰富度）

`find_wheel` 返回结果时采用**混合呈现**策略，平衡信息量和响应速度：

- **top 3 结果**：内联 `details` 字段，包含 README 前 30 行摘要、最多 2 个代码示例、最新 release tag、license 兼容性检查。AI 可直接展示给用户，无需二次调用。
- **top 4-10 结果**：加 `hasDetails: true` 标记，表示详情已预抓取并写入缓存。AI 想展示时调 `get_wheel_details`，**秒回**（命中缓存）。
- **top 11+ 结果**：无标记，需要时调 `get_wheel_details` 实时抓取。
- **非 GitHub 源**（npm/PyPI 等）：不加标记（无 README API）。
- **预抓取失败**：容错跳过，不阻断主搜索流程。

`get_wheel_details` 的缓存与 `find_wheel` 的预抓取共享，避免重复抓取。配置 `FINDAWHEEL_USER_LICENSE` 后，详情里会多出 `licenseCheck` 字段。

### 反馈加权（搜索质量提升）

AI 展示搜索结果后，根据用户反应调 `record_feedback` 记录反馈。反馈持久化到 `~/.findawheel/feedback/`，跨会话累积，影响后续搜索排序：

| 动作 | 分值 | 累加上限 | 含义 |
|:-----|:-----|:-----|:-----|
| `like` | +0.2/次 | +1.0（5 次封顶） | 用户点赞/选用，后续搜索上浮 |
| `click` | +0.05/次 | +0.3（6 次封顶） | 用户点开查看，小幅加分 |
| `hide` | -0.5/次 | 无上限 | 用户说不相关，后续搜索下沉 |

反馈调整量叠加到 `matchScore` 上，调整后重新排序并重新分级推荐等级。结果的 `match` 字段会带 `feedbackDelta`（反馈带来的调整量，正数加分负数扣分）。反馈变化后，搜索缓存（TTL 1h）自然刷新排序。

---

## 📚 深入阅读

| 文档 | 描述 |
|:-----|:-----|
| 📖 [使用指南](./docs/USAGE.md) | 下载、安装、配置、使用全流程 |
| ⚙️ [工作原理](./docs/HOW_IT_WORKS.md) | 内部架构与组件详解 |

---

## 📄 许可证

[MIT](./LICENSE)

---

<div align="center">

<sub>发现 bug 或有改进建议？欢迎提 issue。</sub>

**[🌐 English Version](./README.en.md)**

</div>
