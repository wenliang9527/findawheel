<div align="center">

# 🔍 findawheel

### AI 时代的"找轮子"助手

> 在动手写代码前，先帮你找到已经造好的轮子。

[![Language](https://img.shields.io/badge/lang-English-blue.svg?style=flat-square)](./README.en.md)
[![Node](https://img.shields.io/badge/Node.js-≥18-green.svg?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-1.29-orange.svg?style=flat-square)](https://modelcontextprotocol.io/)
[![Build](https://img.shields.io/badge/build-passing-brightgreen.svg?style=flat-square)](./)
[![Tests](https://img.shields.io/badge/tests-106%2F106-brightgreen.svg?style=flat-square)](./)
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
| 🧠 | **意图识别** | 自动判断 query 是"功能级"还是"项目级"，并拆分核心词/修饰词/反义词 |
| 📊 | **统一归一** | 不同来源的结果统一成 `Wheel` 结构，带推荐等级和理由 |
| 🏆 | **质量排序** | 相关度 + stars + 活跃度 + 下载量 + license + 描述匹配度 |
| 🛡️ | **智能过滤** | 剔除归档/废弃/聚合仓库/反向意图/核心词缺失的结果 |
| ⚡ | **失败降级** | 单源失败不影响其他源；Web 源 Exa 失败自动 fallback Tavily |
| 🌏 | **中文友好** | 50+ 词的中英翻译表，中文 query 自动转英文搜索 |

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
        "TAVILY_API_KEY": "可选，Web 搜索兜底"
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
| `FINDAWHEEL_LIMIT` | 否 | `20` | 默认返回结果数量。 |
| `FINDAWHEEL_TIMEOUT_MS` | 否 | `8000` | 单源请求超时（毫秒）。 |
| `FINDAWHEEL_LOG_LEVEL` | 否 | `info` | 日志级别：`error` \| `warn` \| `info` \| `debug`。 |

---

## 🏗️ 项目架构

```
              AI 调用 find_wheel(query) 或 suggest_queries(query)
                            │
                            ▼
                  ┌─────────────────────┐
                  │  QueryParser        │  ← 拆分核心词/修饰词/反义词/格式词
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
    │  GitHub · Gitee · npm · crates.io · Web    │  │
    │     (Exa 主 + Tavily 兜底)                  │  │
    └─────────────────────┬───────────────────────┘  │
                          ▼                          │
            ┌──────────────────────────────────┐    │
            │  Normalizer → MetricsEnricher    │    │
            │  → Recommender → Ranker          │    │
            │  (归一化+指标+推荐等级+过滤排序)    │    │
            └──────────────────────────────────┘    │
                          ▼                          │
                  Wheel[] + summary 返回给 AI ───────┘
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
| **GitHub** | 开源仓库 | 可选 | `/search/repositories`，支持引号短语 + NOT 反义词排除 |
| **Gitee** | 国内开源仓库 | 不需要 | 补充国内项目，访问速度快 |
| **npm** | JavaScript 包 | 不需要 | 自动补充 stars + 周下载量 |
| **crates.io** | Rust 包 | 不需要 | 返回 downloads，指标最全 |
| **Web (Exa)** | 网页/教程/工具站 | 需要 API key | 神经网络搜索，对代码语义友好（主源） |
| **Web (Tavily)** | 网页/教程/工具站 | 需要 API key | Exa 失败/额度耗尽时自动 fallback |

> ℹ️ **PyPI 策略**：PyPI 无官方搜索 API，通过 GitHub `language:Python` 覆盖 Python 生态。
>
> ℹ️ **零配置 Web 搜索**：如果不想申请 Exa/Tavily key，可并启 [Open-WebSearch MCP](https://github.com/OpenWebSearch) 作为补充，AI 会自动编排。

---

## 🛠️ 提供的工具

| 工具 | 用途 | 何时调用 |
|:-----|:-----|:-----|
| `find_wheel` | 搜索现成轮子 | 用户说"我想做/建/创建一个..."时**第一动作**调用 |
| `suggest_queries` | 生成 4 个搜索词建议 | AI 不确定怎么构造搜索词时调用，拿到精准/动作导向/模糊/简洁 4 个角度的建议 |

---

## 🗺️ 路线图

### ✅ Phase 1（已完成）

- [x] GitHub + npm + crates.io 搜索
- [x] 意图分类与质量排序
- [x] 多源降级与错误处理

### ✅ Phase 2（已完成）

- [x] **Gitee 搜索源** — 国内开源项目覆盖
- [x] **Web 搜索源（Exa 主 + Tavily 兜底）** — 神经网络搜索 + fallback
- [x] **npm 包补充 stars + 周下载量** — 排序更准确
- [x] **中文翻译表** — 50+ 词中英互译，中文 query 自动转英文
- [x] **核心词引号强制命中 + 反义词 NOT 排除** — GitHub 搜索精度提升
- [x] **Ranker 多重过滤** — 反向意图/核心词缺失/格式词缺失过滤
- [x] **推荐等级系统** — 每个结果带 `highly_recommended`/`recommended`/`optional`/`not_recommended` 标签 + 理由
- [x] **suggest_queries 工具** — 生成 4 个角度的搜索词建议
- [x] **同义词副搜索** — 主搜索 + 模糊搜索并行，扩大召回

### 🚧 Phase 3（规划中）

- [ ] 结果缓存与重试机制
- [ ] 评分公式 ML 调参
- [ ] GitLab / PyPI（HTML 解析）独立源
- [ ] 多用户、鉴权、服务端托管

---

## 📚 深入阅读

| 文档 | 描述 |
|:-----|:-----|
| 📖 [使用指南](./docs/USAGE.md) | 下载、安装、配置、使用全流程 |
| ⚙️ [工作原理](./docs/HOW_IT_WORKS.md) | 内部架构与组件详解 |
| 📐 [设计规格](./docs/superpowers/specs/2026-07-02-findawheel-design.md) | 完整设计决策记录 |
| 📝 [实现计划](./docs/superpowers/plans/2026-07-02-findawheel.md) | 16 个任务的 TDD 步骤 |

---

## 📄 许可证

[MIT](./LICENSE)

---

<div align="center">

<sub>发现 bug 或有改进建议？欢迎提 issue。</sub>

**[🌐 English Version](./README.en.md)**

</div>
