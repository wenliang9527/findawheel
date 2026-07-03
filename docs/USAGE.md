<div align="center">

# 📖 findawheel 使用指南

### 下载 · 安装 · 配置 · 使用 全流程指南

[![Back to README](https://img.shields.io/badge/←-返回_README-blue.svg?style=flat-square)](../README.md)
[![How It Works](https://img.shields.io/badge/工作原理-HOW__IT__WORKS-orange.svg?style=flat-square)](./HOW_IT_WORKS.md)

</div>

---

## 📋 目录

| | 章节 | 内容 |
|:---:|:-----|:-----|
| 0 | [环境要求](#-环境要求) | 运行前需要的依赖 |
| 1 | [下载](#1-下载) | 获取项目代码 |
| 2 | [安装](#2-安装) | 依赖安装与构建 |
| 3 | [配置](#3-配置) | 环境变量与 Token |
| 4 | [接入 AI 客户端](#4-接入-ai-客户端) | Trae / Cursor / Claude |
| 5 | [使用](#5-使用) | 工具参数与示例 |
| 6 | [常见问题](#6-常见问题) | FAQ 故障排查 |

---

## 📦 环境要求

| 依赖 | 最低版本 | 说明 |
|:-----|:------:|:-----|
| **Node.js** | 18.0 | 必须使用内置 `fetch` 和原生 ESM 支持 |
| **npm** | 8.0 | 随 Node 18+ 附带 |
| **Git** | 任意 | 用于克隆仓库 |

检查环境：

```bash
node --version    # 应输出 v18.x 或更高
npm --version     # 应输出 8.x 或更高
git --version     # 任意版本
```

---

## 1. 下载

### 方式一：克隆 Git 仓库（推荐）

```bash
git clone <repo-url> findawheel
cd findawheel
```

### 方式二：下载 ZIP

如果你不使用 Git，可以从仓库页面下载 ZIP 压缩包，解压后进入目录。

---

## 2. 安装

### 2.1 安装依赖

在项目根目录执行：

```bash
npm install
```

此命令会安装以下依赖：

<details>
<summary><b>📦 依赖清单（点击展开）</b></summary>

**运行时依赖**：
- `@modelcontextprotocol/sdk` — MCP 官方 SDK
- `zod` — 输入校验

**开发依赖**：
- `typescript` — TypeScript 编译器
- `vitest` — 测试框架
- `@types/node` — Node.js 类型定义

</details>

> ⏱️ 首次安装约需 30 秒，取决于网络状况。

### 2.2 构建项目

将 TypeScript 源码编译为可执行的 JavaScript：

```bash
npm run build
```

成功后会在项目根目录生成 `dist/` 文件夹，包含编译后的 `.js`、`.d.ts`、`.js.map` 文件。

### 2.3 验证安装

运行测试套件确认一切正常：

```bash
npm test
```

预期输出：

```
 Test Files  14 passed (14)
      Tests  106 passed (106)
```

也可以做一次手动冒烟测试，验证 MCP 服务能响应请求：

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.0.0"}}}' | node dist/index.js
```

预期返回包含 `findawheel` 的 JSON-RPC 响应。

---

## 3. 配置

### 3.1 环境变量

findawheel 通过环境变量配置，**全部可选**（零配置也能跑，但功能会受限）：

| 变量 | 必填 | 默认值 | 说明 |
|:-----|:---:|:------:|:-----|
| `GITHUB_TOKEN` | 否 | — | GitHub Personal Access Token。未配置时 GitHub API 限流 60 次/小时；配置后提升到 5000 次/小时。 |
| `EXA_API_KEY` | 否 | — | Exa API key，启用 Web 神经网络搜索（主源）。未配置时跳过 Exa 搜索。[获取](https://exa.ai) |
| `TAVILY_API_KEY` | 否 | — | Tavily API key，Web 搜索兜底（Exa 失败/额度耗尽时使用）。[获取](https://tavily.com) |
| `GITLAB_TOKEN` | 否 | — | GitLab token（可选，提升 GitLab 搜索限流，匿名也可搜）。 |
| `LIBRARIES_IO_API_KEY` | 否 | — | Libraries.io API key，启用多包管理器搜索（覆盖 npm/pypi/rubygems/cargo/maven 等 30+ 平台）。[获取](https://libraries.io/account) |
| `FINDAWHEEL_CACHE_ENABLED` | 否 | `true` | 是否启用本地缓存（`~/.findawheel/cache/`）。设为 `false` 可禁用。 |
| `FINDAWHEEL_CACHE_TTL_MS` | 否 | `3600000` | 缓存 TTL（毫秒），默认 1 小时。 |
| `FINDAWHEEL_LIMIT` | 否 | `20` | 默认返回结果数量上限。 |
| `FINDAWHEEL_TIMEOUT_MS` | 否 | `8000` | 单个数据源请求超时时间（毫秒）。 |
| `FINDAWHEEL_LOG_LEVEL` | 否 | `info` | 日志级别：`error` / `warn` / `info` / `debug`。 |

> 💡 **Web 搜索源说明**：Exa 是主源，Tavily 是兜底。两者都未配置时，findawheel 只会查询 GitHub/Gitee/npm/crates.io，不影响核心功能。建议至少配置一个以获得更广覆盖。

### 3.2 获取 GitHub Token（强烈推荐）

> ⚠️ 未配置 Token 时 GitHub API 限流只有 **60 次/小时**，正常使用很容易触顶。

**获取步骤**：

1. 访问 https://github.com/settings/tokens
2. 点击 **Generate new token (classic)**
3. 勾选 `public_repo`（读取公开仓库信息）
4. 生成后复制 Token（形如 `ghp_xxxxxxxxxxxx`）

### 3.3 获取 Exa / Tavily API Key（可选，启用 Web 搜索）

Web 搜索源采用 **Exa 主 + Tavily 兜底**策略。Exa 失败（402 额度耗尽 / 429 限流 / 网络错误）时自动切换 Tavily。

**Exa（主源）**：
1. 访问 https://exa.ai
2. 注册账号并在 dashboard 获取 API key
3. 免费额度：每月 1000 次搜索

**Tavily（兜底）**：
1. 访问 https://tavily.com
2. 注册账号并获取 API key
3. 免费额度：每月 1000 次搜索

> 💡 两个 key 都配齐可获得最稳定的 Web 搜索体验；只配一个也能跑，只是没有 fallback。

### 3.4 配置方式

#### 方式一：写入 `.env` 文件（开发时推荐）

复制 `.env.example` 为 `.env`，填入实际值：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
GITHUB_TOKEN=ghp_your_token_here
EXA_API_KEY=your_exa_key_here
TAVILY_API_KEY=your_tavily_key_here
GITLAB_TOKEN=
LIBRARIES_IO_API_KEY=
FINDAWHEEL_CACHE_ENABLED=true
FINDAWHEEL_CACHE_TTL_MS=3600000
FINDAWHEEL_LIMIT=20
FINDAWHEEL_TIMEOUT_MS=8000
FINDAWHEEL_LOG_LEVEL=info
```

> 🔒 `.env` 文件已在 `.gitignore` 中排除，不会被提交。

#### 方式二：在 MCP 客户端配置里指定（接入时推荐）

见下一节。

---

## 4. 接入 AI 客户端

findawheel 是一个 **stdio 类型**的 MCP 服务，需要在支持 MCP 的 AI 客户端中注册。

### 4.1 Trae

在 Trae 的 MCP 配置文件（通常位于设置中或 `~/.trae/mcp.json`）添加：

```json
{
  "mcpServers": {
    "findawheel": {
      "command": "node",
      "args": ["D:\\WORK_VSCODE\\Vibe-coding\\findawheel\\dist\\index.js"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here",
        "EXA_API_KEY": "your_exa_key_here",
        "TAVILY_API_KEY": "your_tavily_key_here",
        "GITLAB_TOKEN": "",
        "LIBRARIES_IO_API_KEY": ""
      }
    }
  }
}
```

> ⚠️ `args` 里的路径必须是**绝对路径**，指向你本机的 `dist/index.js`。
> Windows 用 `\\` 双反斜杠或 `/` 正斜杠。
> 💡 Trae 通过 MCP 配置 GUI 设置环境变量，**不会**自动读取 `.env` 文件。

### 4.2 Cursor

在 Cursor 设置 → MCP 中添加相同配置，或编辑 `~/.cursor/mcp.json`。

### 4.3 Claude Desktop

编辑 `claude_desktop_config.json`：

| 系统 | 路径 |
|:-----|:-----|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "findawheel": {
      "command": "node",
      "args": ["/absolute/path/to/findawheel/dist/index.js"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here",
        "EXA_API_KEY": "your_exa_key_here",
        "TAVILY_API_KEY": "your_tavily_key_here",
        "GITLAB_TOKEN": "",
        "LIBRARIES_IO_API_KEY": ""
      }
    }
  }
}
```

### 4.4 验证接入

1. 保存配置文件
2. **重启 AI 客户端**（必须重启才能加载新配置）
3. 在对话中输入类似："帮我搜索有没有 markdown 转 pdf 的现成工具"
4. AI 应该会调用 `find_wheel` 工具并返回推荐

> 💡 如果客户端支持查看 MCP 工具列表，你应该能看到名为 `find_wheel` 的工具。

---

## 5. 使用

### 5.1 工作方式

> 📌 findawheel **不是命令行工具，而是 MCP 服务**。你不需要手动调用它——AI 客户端会在合适时机自动调用。

典型流程：

```
你: 我想做一个图片压缩的命令行工具
    ↓
AI: （不确定搜索词，先调用 suggest_queries 生成 4 个角度的搜索词建议）
    ↓
AI: （选择最合适的搜索词，调用 find_wheel，query="image compress cli"）
    ↓
AI: 我找到了这些现成的轮子，按推荐等级分组：

     🟢 强烈推荐 (highly_recommended)
     1. sharp — 高性能图像处理，stars 28k，MIT，最近更新于 2025-06
        匹配度 0.92，命中核心词 image/compress/cli
     2. squoosh — Google 出品，stars 18k，Apache-2.0
        匹配度 0.85

     🔵 推荐 (recommended)
     3. jimp — 纯 JS 图像处理，stars 12k
     4. imagemin — 插件式压缩管道，stars 5k

     建议直接用 sharp，除非你想学习底层原理。
```

> 💡 findawheel 会在结果顶部输出 `summary` 段，按推荐等级（`highly_recommended` / `recommended` / `optional` / `not_recommended`）列出所有结果名。AI 应依据此 summary 分组展示，而非只列一条。

### 5.2 提供的工具

findawheel 注册了两个 MCP 工具：

| 工具 | 用途 | 何时调用 |
|:-----|:-----|:-----|
| `find_wheel` | 搜索现成轮子 | 用户说"我想做/建/创建一个..."时**第一动作**调用 |
| `suggest_queries` | 生成 4 个角度的搜索词建议 | AI 不确定怎么构造搜索词时调用，返回 precise / action_oriented / fuzzy / concise 四个变体 |

> ⚠️ **AI 客户端注意事项**：
> - 用户表达"我想做/建/创建一个..."时，**必须先调用 `find_wheel`** 再开始任何创意工作（头脑风暴/设计/规划/编码）
> - 不要把用户原话直接传入 query，应先理解意图后生成精准的英文搜索词
> - 不确定搜索词时，先调用 `suggest_queries` 获取建议

### 5.3 find_wheel 工具参数

`find_wheel` 工具接受以下参数（AI 会自动构造，你也可以在对话中暗示）：

| 参数 | 类型 | 必填 | 默认 | 说明 |
|:-----|:-----|:---:|:------:|:-----|
| `query` | string | ✅ | — | 功能或项目描述，**英文**自然语言（中文会被翻译） |
| `intent` | `'feature'` \| `'project'` \| `'auto'` | ❌ | `'auto'` | 查询意图 |
| `ecosystem` | string | ❌ | 无 | 技术栈：`js` / `ts` / `python` / `rust` / `go` / `java` |
| `limit` | number | ❌ | `20` | 返回结果上限 |

### 5.4 返回结构

工具返回 JSON，结构如下（顶部是 `summary` 引导段，下方是详细 `wheels` 数组）：

```json
{
  "summary": {
    "total": 60,
    "highly_recommended": ["sharp", "squoosh"],
    "recommended": ["jimp", "imagemin"],
    "optional": ["tinify"],
    "not_recommended": []
  },
  "query": "image compress cli",
  "intent": "feature",
  "total": 60,
  "wheels": [
    {
      "name": "lovell/sharp",
      "source": "github",
      "url": "https://github.com/lovell/sharp",
      "description": "High performance Node.js image processing",
      "type": "project",
      "metrics": {
        "stars": 28000,
        "lastUpdated": "2025-06-01T00:00:00Z",
        "license": "MIT",
        "archived": false,
        "activity": "high"
      },
      "match": {
        "score": 0.92,
        "recommendation": "highly_recommended",
        "reason": "命中核心词 image/compress/cli，stars 高，活跃维护",
        "matchedKeywords": ["image", "compress", "cli"]
      }
    }
  ]
}
```

### 5.5 高级用法

> 💡 **指定技术栈**

在对话中说明你用的语言，AI 会传入 `ecosystem` 过滤：

> "我在写一个 Rust 项目，需要一个 HTTP 客户端库"

> 💡 **指定查询意图**

明确说"找一个完整的开源项目"或"找一个能 import 的包"：

> "我想找一个现成的笔记应用项目参考"
> "我需要一个能解析 markdown 的 npm 包"

> 💡 **控制结果数量**

> "给我列 5 个最相关的就行"

### 5.6 开发模式

如果你要修改 findawheel 本身：

```bash
npm run dev        # TypeScript 热编译，改源码自动重新编译
npm run test:watch # 测试监听模式
```

> ⚠️ 修改后需要重启 AI 客户端才能加载新的 `dist/index.js`。

---

## 6. 常见问题

<details>
<summary><b>❌ 启动后 AI 调用 find_wheel 报错"all data sources unavailable"</b></summary>

**原因**：所有数据源都失败了，通常是网络问题或 GitHub 限流。

**解决**：

1. 检查网络是否能访问 `api.github.com`、`registry.npmjs.org`、`crates.io`
2. 配置 `GITHUB_TOKEN` 环境变量提升限流额度
3. 查看 `FINDAWHEEL_LOG_LEVEL=debug` 的日志输出定位具体原因

</details>

<details>
<summary><b>⚠️ 返回结果全是 awesome 列表，不是具体工具</b></summary>

**原因**：GitHub Search API 的匹配机制——awesome 列表的 README 包含大量关键词，容易匹配到高位。

**解决**：

- 在 query 里加更具体的技术词（如 `markdown-to-pdf converter library` 而非 `markdown pdf`）
- 指定 `ecosystem` 缩小范围到包管理器
- 指定 `intent=feature` 让搜索侧重包而非项目

</details>

<details>
<summary><b>🖥️ Windows 下路径配置报错</b></summary>

**原因**：JSON 字符串里的反斜杠需要转义。

**解决**：用 `\\` 双反斜杠，或改用 `/` 正斜杠（Node.js 都支持）：

```json
"args": ["D:/WORK_VSCODE/Vibe-coding/findawheel/dist/index.js"]
```

</details>

<details>
<summary><b>🔍 重启客户端后工具没出现</b></summary>

**排查步骤**：

1. 确认 `dist/index.js` 文件存在（已运行 `npm run build`）
2. 用命令行手动测试服务能否启动：

   ```bash
   echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' | node dist/index.js
   ```

3. 检查配置文件 JSON 格式是否正确（多余逗号、引号未闭合等）
4. 查看客户端的日志输出

</details>

<details>
<summary><b>🔑 npm install 时报权限错误</b></summary>

**解决**：

- Windows：用管理员身份打开终端
- macOS/Linux：`sudo npm install` 或配置 npm 全局前缀到用户目录

</details>

<details>
<summary><b>⏱️ 配置了 GITHUB_TOKEN 还是限流</b></summary>

**排查**：

1. 确认 Token 有效（未过期、未撤销）
2. 确认环境变量真的传入了进程——在 MCP 配置的 `env` 字段里设置，而非依赖 shell 环境
3. 用 `curl -H "Authorization: Bearer ghp_xxx" https://api.github.com/rate_limit` 查看 Token 的限流状态

</details>

<details>
<summary><b>🌐 Web 搜索源没结果或报错</b></summary>

**原因**：Exa/Tavily API key 未配置、额度耗尽或网络问题。

**排查**：

1. 确认 `EXA_API_KEY` / `TAVILY_API_KEY` 已在 MCP 配置的 `env` 字段中设置
2. 把 `FINDAWHEEL_LOG_LEVEL=debug`，查看日志中 `WebSourceAdapter` 的错误信息
3. Exa 返回 402 表示额度耗尽，会自动 fallback 到 Tavily（若配置了）
4. Exa 返回 401/403 表示 key 无效，**不会** fallback（避免无意义请求），需修正 key
5. 两个 key 都未配置时，findawheel 仍可正常使用 GitHub/Gitee/npm/crates.io 四个源

</details>

<details>
<summary><b>🇨🇳 中文搜索结果全是英文项目</b></summary>

**说明**：这是预期行为。findawheel 内置 50+ 词的中英翻译表，会把中文 query 翻译成英文再去 GitHub/npm/crates/Web 搜索，因为绝大多数开源项目用英文命名和描述。

**如果想要国内项目**：Gitee 源会用中文+英文联合搜索，国内项目会优先出现在 Gitee 结果中。

</details>

---

<div align="center">

## 📚 进一步阅读

| | 文档 | 描述 |
|:---:|:-----|:-----|
| 🏠 | [README](../README.md) | 项目总览 |
| ⚙️ | [工作原理](./HOW_IT_WORKS.md) | 内部架构详解 |
| 📐 | [设计规格](./superpowers/specs/2026-07-02-findawheel-design.md) | 完整设计文档 |
| 🌐 | [MCP 协议官网](https://modelcontextprotocol.io/) | 理解 MCP 协议本身 |

</div>

---

<div align="center">

<sub>本文档由 findawheel 项目维护</sub>

**[↑ 返回顶部](#-findawheel-使用指南)**

</div>
