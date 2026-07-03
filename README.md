<div align="center">

# 🔍 findawheel

### AI 时代的"找轮子"助手

> 在动手写代码前，先帮你找到已经造好的轮子。

[![Language](https://img.shields.io/badge/lang-English-blue.svg?style=flat-square)](./README.en.md)
[![Node](https://img.shields.io/badge/Node.js-≥18-green.svg?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-1.29-orange.svg?style=flat-square)](https://modelcontextprotocol.io/)
[![Build](https://img.shields.io/badge/build-passing-brightgreen.svg?style=flat-square)](./)
[![Tests](https://img.shields.io/badge/tests-46%2F46-brightgreen.svg?style=flat-square)](./)
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
| 🔎 | **多源搜索** | 同时搜索 GitHub、npm、crates.io |
| 🧠 | **意图识别** | 自动判断 query 是"功能级"还是"项目级" |
| 📊 | **统一归一** | 不同来源的结果统一成 `Wheel` 结构 |
| 🏆 | **质量排序** | stars / 更新时间 / 活跃度 / 下载量 / license |
| 🛡️ | **自动过滤** | 剔除归档、长期不更新、信息不足的结果 |
| ⚡ | **失败降级** | 单源失败不影响其他源返回结果 |

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
        "GITHUB_TOKEN": "可选，但强烈建议配置"
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
| `GITHUB_TOKEN` | 否 | — | GitHub Personal Access Token。未配置时限流 60 次/小时。 |
| `FINDAWHEEL_LIMIT` | 否 | `10` | 默认返回结果数量。 |
| `FINDAWHEEL_TIMEOUT_MS` | 否 | `8000` | 单源请求超时（毫秒）。 |
| `FINDAWHEEL_LOG_LEVEL` | 否 | `info` | 日志级别：`error` \| `warn` \| `info` \| `debug`。 |

---

## 🏗️ 项目架构

```
                  AI 调用 find_wheel(query)
                            │
                            ▼
                  ┌─────────────────────┐
                  │  QueryClassifier    │  ← 判断 feature / project
                  └─────────────────────┘
                            │
                            ▼
                  ┌─────────────────────┐
                  │   SourceAdapters    │  ← GitHub / npm / crates.io 并行搜索
                  └─────────────────────┘
                            │
                            ▼
            ┌──────────────────────────────────┐
            │  Normalizer → MetricsEnricher    │  ← 归一化 + 补充指标
            │           → Ranker               │  ← 过滤 + 评分 + 去重
            └──────────────────────────────────┘
                            │
                            ▼
                    Wheel[] 返回给 AI
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

| 数据源 | 类型 | 说明 |
|:------|:-----|:-----|
| **GitHub** | 开源仓库 | `/search/repositories`，按 stars 排序 |
| **npm** | JavaScript 包 | registry 搜索 |
| **crates.io** | Rust 包 | crates 搜索 |

> ℹ️ PyPI 没有官方搜索 API，一期通过 GitHub 镜像仓库覆盖 Python 生态。二期计划接入通用 Web 搜索（Exa / Brave）。

---

## 🗺️ 路线图

### ✅ Phase 1（已完成）

- [x] GitHub + npm + crates.io 搜索
- [x] 意图分类与质量排序
- [x] 多源降级与错误处理

### 🚧 Phase 2（规划中）

- [ ] Web 搜索源（Exa / Brave）
- [ ] 结果缓存与重试机制
- [ ] npm 下载量与 README 摘要
- [ ] 评分公式调优

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
