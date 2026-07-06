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
| `GITEE_TOKEN` | 否 | — | Gitee token（可选，提升 Gitee 搜索限流：匿名 60/hour，认证 5000/hour，匿名也可搜）。[获取](https://gitee.com/profile/personal_access_tokens) |
| `LIBRARIES_IO_API_KEY` | 否 | — | Libraries.io API key，启用多包管理器搜索（覆盖 npm/pypi/rubygems/cargo/maven 等 30+ 平台）。[获取](https://libraries.io/account) |
| `FINDAWHEEL_USER_LICENSE` | 否 | — | 你的项目 license（如 `MIT`/`Apache-2.0`/`GPL-3.0`）。配置后，详情里会包含 `licenseCheck` 字段，标注每个轮子 license 是否兼容（避免 license 传染）。 |
| `FINDAWHEEL_CACHE_ENABLED` | 否 | `true` | 是否启用本地缓存（`~/.findawheel/cache/`）。设为 `false` 可禁用。 |
| `FINDAWHEEL_FEEDBACK_DIR` | 否 | `~/.findawheel/feedback/` | 反馈存储目录。持久化用户反馈（like/hide/click），跨会话累积影响排序。无 TTL，手动清理。 |
| `FINDAWHEEL_CACHE_TTL_MS` | 否 | `3600000` | 缓存 TTL（毫秒），默认 1 小时。 |
| `FINDAWHEEL_LIMIT` | 否 | `20` | 默认返回结果数量上限。 |
| `FINDAWHEEL_TIMEOUT_MS` | 否 | `8000` | 单个数据源请求超时时间（毫秒）。 |
| `FINDAWHEEL_LOG_LEVEL` | 否 | `info` | 日志级别：`error` / `warn` / `info` / `debug`。 |
| `FINDAWHEEL_KB_ENABLED` | 否 | `false` | 是否启用知识库搜索（`search_knowledge` 工具）。设为 `true` 后需配合 `FINDAWHEEL_KB_ROOT`。 |
| `FINDAWHEEL_KB_ROOT` | 否 | — | 知识库根目录（支持多个，逗号分隔）。如 Obsidian vault 路径、笔记文件夹。 |
| `FINDAWHEEL_KB_MAX_FILE_KB` | 否 | `100` | 知识库单文件大小上限（KB），超过则跳过。避免读取超大文件。 |
| `FINDAWHEEL_KB_CACHE_ENABLED` | 否 | `false` | 知识库搜索是否走磁盘缓存。默认 `false`（每次扫描保证最新）；设为 `true` 走主缓存（TTL 1h）。 |

> 💡 **Web 搜索源说明**：Exa 是主源，Tavily 是兜底。两者都未配置时，findawheel 只会查询 GitHub/Gitee/npm/crates.io，不影响核心功能。建议至少配置一个以获得更广覆盖。

### 3.2 获取 GitHub Token（强烈推荐）

> ⚠️ 未配置 Token 时 GitHub API 限流只有 **60 次/小时**，正常使用很容易触顶。配置后提升到 **5000 次/小时**，覆盖 GitHub 仓库搜索 + GitHub Code Search 两个数据源。

**获取步骤**：

1. 浏览器打开 https://github.com/settings/tokens（需先登录 GitHub 账号）
2. 点击右上角 **Generate new token** → 选择 **Generate new token (classic)**
3. 填写 **Note** 字段备注用途，如 `findawheel`
4. 选择 **Expiration** 过期时间（建议 `90 days` 或 `No expiration`，避免频繁续期）
5. 勾选权限范围（scope）：
   - ✅ `public_repo`（读取公开仓库信息，**必须**）
   - ✅ `read:org`（如需搜索组织仓库，可选）
   - 其他权限一律不勾（findawheel 只读公开数据，无需写入权限）
6. 点击底部 **Generate token** 按钮
7. **立即复制**生成的 Token（形如 `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`），离开页面后将无法再次查看
8. 把 Token 填入 MCP 配置：
   ```json
   "env": { "GITHUB_TOKEN": "ghp_xxxxxxxxxxxx" }
   ```

> 🔒 **安全提示**：
> - Token 等同于你的账号密码，切勿提交到 Git 仓库或截图分享
> - 怀疑泄露立即在 https://github.com/settings/tokens 点 **Delete** 撤销
> - 建议使用 Fine-grained token（仅授权具体仓库），最小权限原则
> - `.env` 文件已在 `.gitignore` 中排除

### 3.3 获取 Exa / Tavily API Key（可选，启用 Web 搜索）

Web 搜索源采用 **Exa 主 + Tavily 兜底**策略。Exa 失败（402 额度耗尽 / 429 限流 / 网络错误）时自动切换 Tavily。两个 key 都是可选的——都不配置时 findawheel 仍能查询 GitHub / Gitee / npm / crates.io / PyPI 等数据源，只是缺少 Web 维度的发现能力。

#### Exa（主源，神经网络搜索）

1. 浏览器打开 https://exa.ai
2. 点击右上角 **Sign Up** 注册账号（支持 GitHub / Google 登录）
3. 登录后进入 Dashboard：https://dashboard.exa.ai/
4. 在 **API Keys** 页面点击 **Create API Key**
5. 填写 key 名称（如 `findawheel`），复制生成的 key（形如 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`）
6. 把 key 填入 MCP 配置：
   ```json
   "env": { "EXA_API_KEY": "your_exa_key_here" }
   ```
7. **免费额度**：每月 1000 次搜索，超出后按量计费（约 $0.001/次）
8. 用量查看：Dashboard → **Usage** 页面

#### Tavily（兜底源）

1. 浏览器打开 https://tavily.com
2. 点击 **Get Started** 或 **Sign Up** 注册账号
3. 登录后进入 https://app.tavily.com/
4. 在左侧菜单 **API Keys** 页面复制默认 key（或点 **Create API Key** 生成新 key）
5. 把 key 填入 MCP 配置：
   ```json
   "env": { "TAVILY_API_KEY": "your_tavily_key_here" }
   ```
6. **免费额度**：每月 1000 次搜索，注册后自动赠送
7. 用量查看：Dashboard → **Usage** 页面

> 💡 **两个 key 都配齐**可获得最稳定的 Web 搜索体验（主源失败时自动 fallback）；只配一个也能跑，只是没有 fallback。**国内网络**访问 Exa/Tavily 需要代理，详见第 6 节 FAQ。

### 3.4 获取 GitLab Token（可选，提升 GitLab 搜索限流）

> 💡 GitLab 数据源支持匿名搜索（无需 Token 也能用），但匿名限流较严。配置 Token 后限流提升，且能搜索私有仓库（如配置了私有 token）。

**获取步骤**：

1. 浏览器打开 https://gitlab.com/-/user_settings/personal_access_tokens（需先登录 GitLab 账号）
   - 自建 GitLab 实例请访问：`https://your-gitlab.example.com/-/user_settings/personal_access_tokens`
2. 点击 **Add new token**
3. 填写 **Token name**（如 `findawheel`）
4. 设置 **Expiration date**（建议 1 年后，GitLab 强制最长期限）
5. 勾选权限范围（scopes）：
   - ✅ `read_api`（读取 API，**必须**）
   - 如需搜索私有仓库：勾选 `read_repository`
   - 其他权限一律不勾
6. 点击底部 **Create personal access token**
7. **立即复制**生成的 Token（形如 `glpat-xxxxxxxxxxxxxxxxxxxx`），离开页面后将无法再次查看
8. 把 Token 填入 MCP 配置：
   ```json
   "env": { "GITLAB_TOKEN": "glpat-xxxxxxxxxxxxxxxxxxxx" }
   ```
8. （可选）Gitee token 同理，在 MCP 配置里加：
   ```json
   "env": { "GITEE_TOKEN": "你的gitee私人token" }
   ```

> ⚠️ **自建 GitLab 实例说明**：findawheel 默认查询 `gitlab.com`。如需查询自建实例，需要修改源码中的 `GITLAB_API_BASE`（详见 `src/sources/gitlabSourceAdapter.ts`）。

### 3.5 获取 Libraries.io API Key（可选，启用多包管理器搜索）

> 💡 Libraries.io 聚合了 30+ 包管理器（npm / PyPI / RubyGems / Cargo / Maven / Go modules / Hex / NuGet 等），覆盖范围远超单一源。**未配置时跳过此源**，不影响其他源搜索。

**获取步骤**：

1. 浏览器打开 https://libraries.io/account
2. 点击 **Sign Up** 注册账号（支持 GitHub / GitLab 登录）
3. 登录后进入 https://libraries.io/account 页面
4. 在 **API Key** 区域复制默认 key（形如 `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`）
   - 若默认 key 为空，点击 **Generate API Key** 创建
5. 把 key 填入 MCP 配置：
   ```json
   "env": { "LIBRARIES_IO_API_KEY": "your_libraries_io_key_here" }
   ```
6. **免费额度**：每日 60 次请求（未配置 key 时完全无法调用此源）
7. 用量限制说明：https://libraries.io/api#rate-limit

> ⚠️ **Libraries.io 服务状态**：Libraries.io 是公益项目，偶尔会出现服务不稳定或限流较严。findawheel 已实现容错：单次请求失败不影响其他数据源。

### 3.6 配置个人知识库（可选，启用 `search_knowledge` 工具）

`search_knowledge` 是独立于 `find_wheel` 的 MCP 工具，用于搜索用户本地 Markdown 知识库（Obsidian vault、Logseq 库、任意 `.md` 文件夹）。AI 在用户问"团队文档/个人笔记/内部规范"时调用此工具，问"现成轮子"时仍调 `find_wheel`。

**核心特性**：
- 多根支持（逗号分隔多个路径）
- 标签提取：YAML frontmatter `tags:` / `categories:` + 正文 inline `#tag`
- 搜索字段优先级：`title > path > tag > content`
- 缓存可选（默认关闭，每次扫描保证最新）

**配置步骤**：

1. 找到你的知识库根目录（如 Obsidian vault 所在路径）：
   ```bash
   # macOS/Linux 示例
   /home/user/Documents/ObsidianVault

   # Windows 示例
   D:\Notes\MyVault
   ```

2. 在 MCP 配置的 `env` 字段添加：
   ```json
   "env": {
     "FINDAWHEEL_KB_ENABLED": "true",
     "FINDAWHEEL_KB_ROOT": "/home/user/Documents/ObsidianVault"
   }
   ```

3. 多知识库配置（逗号分隔）：
   ```json
   "env": {
     "FINDAWHEEL_KB_ENABLED": "true",
     "FINDAWHEEL_KB_ROOT": "/home/user/Documents/ObsidianVault,/home/user/Projects/team-wiki"
   }
   ```

4. Windows 路径（注意 JSON 转义，用双反斜杠）：
   ```json
   "env": {
     "FINDAWHEEL_KB_ENABLED": "true",
     "FINDAWHEEL_KB_ROOT": "D:\\Notes\\MyVault,E:\\TeamWiki"
   }
   ```

5. 可选：启用缓存（适合大库，减少重复扫描）：
   ```json
   "env": {
     "FINDAWHEEL_KB_ENABLED": "true",
     "FINDAWHEEL_KB_ROOT": "/home/user/Documents/ObsidianVault",
     "FINDAWHEEL_KB_CACHE_ENABLED": "true"
   }
   ```

**支持的 Markdown 格式**：

```markdown
---
tags: [architecture, decision]   # frontmatter 数组格式
categories: [kubernetes, deploy]  # categories 也作为标签
---

# 文档标题

正文内容...包含 inline #tag 标签

这里 #backend #security 会被提取为标签
```

**返回结构示例**：

```json
{
  "query": "redis",
  "total": 2,
  "items": [
    {
      "title": "ADR 001: Use Redis for Cache",
      "relativePath": "notes/adr-001.md",
      "absolutePath": "/home/user/Documents/ObsidianVault/notes/adr-001.md",
      "url": "file:///home/user/Documents/ObsidianVault/notes/adr-001.md",
      "snippet": "We decided to use Redis as the cache layer...",
      "tags": ["architecture", "decision"],
      "lastUpdated": "2026-07-04T12:00:00.000Z",
      "matchedField": "tag",
      "kbRoot": "/home/user/Documents/ObsidianVault"
    }
  ]
}
```

**限制说明**：
- 暂只支持 `.md` 文件（不支持 `.txt` / `.org` / `.docx`）
- 不做全文搜索或向量检索（保持零依赖）
- 单文件超过 100KB 自动跳过（可用 `FINDAWHEEL_KB_MAX_FILE_KB` 调整）
- 隐藏目录（`.git` / `.obsidian` / `.trash`）自动跳过

**智能识别**：findawheel 会自动检测知识库类型并在结果的 `kbType` 字段返回：
- `obsidian`：顶层有 `.obsidian/` 配置目录
- `logseq`：顶层有 `logseq/` + `pages/` 或 `journals/` 目录
- `siyuan`：顶层有 `conf/` + `data/` 目录（思源笔记）
- `plain`：普通 `.md` 文件夹，无特定结构

**标签提取来源**：
- YAML frontmatter 的 `tags:` / `categories:` 字段（数组或多行格式）
- YAML frontmatter 的 `aliases:` 字段（Obsidian 别名，也作为可搜索标签）
- 正文 inline `#tag`（排除 `##` 标题语法）
- 正文 `[[wiki-link]]` 双向链接（支持 `[[note]]` / `[[note|alias]]` / `[[note#heading]]` / `[[note#^block-id]]` 四种格式，提取为 tags 提升召回）

### 3.7 与专用 MCP 服务器共存（推荐）

findawheel 的 `search_knowledge` 工具是**轻量只读**方案，零依赖、即装即用、支持任意 `.md` 文件夹。但它不做全文搜索、不支持写操作、不依赖目标软件运行。

如果你是重度 Obsidian / Notion 用户，需要**深度集成**（写操作、全文搜索、向量检索、数据库查询），推荐**同时配置专用 MCP 服务器**。两者职责互补：

| 维度 | findawheel search_knowledge | 专用 MCP（如 obsidian-mcp） |
|:---|:---|:---|
| 依赖 | 零依赖，纯文件系统扫描 | 需目标软件运行 + 插件 + token |
| 部署 | 即装即用，配 `KB_ROOT` 即可 | 用户需先装 Obsidian + REST API 插件 |
| 覆盖范围 | 任意 `.md` 文件夹（支持多根） | 仅限特定工具的库 |
| 搜索深度 | 标题/路径/标签/正文前 500 字 | 全文搜索 + 高级查询 |
| 写操作 | 只读 | 可创建/更新/删除笔记 |
| 集成度 | 与 find_wheel 同进程，AI 无缝切换 | 独立 MCP，用户需配多个 server |

#### 推荐搭配的专用 MCP 服务器

| 知识库工具 | 推荐的 MCP 服务器 | 安装方式 | 获取 token |
|:---|:---|:---|:---|
| **Obsidian** | [`@newtype-01/obsidian-mcp`](https://github.com/newtype-01/obsidian-mcp) | 需先装 [Local REST API 插件](https://github.com/coddingtonbear/obsidian-local-rest-api) | Obsidian 设置 → 社区插件 → Local REST API → 复制 token |
| **Notion** | [官方 Notion MCP Server](https://developers.notion.com/docs/mcp) | 走 Notion API | [Notion My Integrations](https://www.notion.so/my-integrations) → 创建 integration → 复制 token |
| **Logseq** | 暂无独立 MCP，可用 [llama-logseq 插件](https://github.com/herculeslaza/llama-logseq) 走 ollama | Logseq 插件市场安装 | 无需 token，需本地运行 ollama |
| **思源笔记** | 原生 AI 接入（OpenAI 兼容），暂无独立 MCP | 思源设置 → AI → 配置 API | 用 OpenAI key 或 DMXAPI 中转 |

#### 共存配置示例（findawheel + obsidian-mcp 同时使用）

在 AI 客户端的 MCP 配置中同时注册两个 server：

```json
{
  "mcpServers": {
    "findawheel": {
      "command": "node",
      "args": ["/path/to/findawheel/dist/index.js"],
      "env": {
        "FINDAWHEEL_KB_ENABLED": "true",
        "FINDAWHEEL_KB_ROOT": "/home/user/Documents/ObsidianVault",
        "GITHUB_TOKEN": "ghp_xxxxxxxx"
      }
    },
    "obsidian-mcp": {
      "command": "node",
      "args": ["/path/to/obsidian-mcp/dist/index.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/home/user/Documents/ObsidianVault",
        "OBSIDIAN_API_TOKEN": "your_obsidian_rest_api_token",
        "OBSIDIAN_API_PORT": "27123"
      }
    }
  }
}
```

**使用场景分工**：
- **轻量搜索**（"我的笔记里有没有 redis 相关的"）→ AI 调 `findawheel` 的 `search_knowledge`（快、零依赖、命中标题/路径/标签即可）
- **深度操作**（"帮我把这篇笔记的标签改成 redis, cache" / "全文搜索包含 'deploy' 的所有笔记" / "创建一篇新笔记"）→ AI 调 `obsidian-mcp` 的 `search_vault` / `update_note` / `create_note`

> 💡 **findawheel 不与专用 MCP 竞争，而是互补**：findawheel 负责轻量快速搜索（无需 Obsidian 运行也能用），专用 MCP 处理深度集成。两者可同时配置，AI 按需选择。

### 3.8 配置方式

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
GITEE_TOKEN=
LIBRARIES_IO_API_KEY=
FINDAWHEEL_USER_LICENSE=
FINDAWHEEL_FEEDBACK_DIR=
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
        "GITEE_TOKEN": "",
        "LIBRARIES_IO_API_KEY": "",
        "FINDAWHEEL_USER_LICENSE": "",
        "FINDAWHEEL_FEEDBACK_DIR": ""
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
        "GITEE_TOKEN": "",
        "LIBRARIES_IO_API_KEY": "",
        "FINDAWHEEL_USER_LICENSE": "",
        "FINDAWHEEL_FEEDBACK_DIR": ""
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

findawheel 注册了五个 MCP 工具：

| 工具 | 用途 | 何时调用 |
|:-----|:-----|:-----|
| `find_wheel` | 搜索现成轮子 | 用户说"我想做/建/创建一个..."时**第一动作**调用 |
| `suggest_queries` | 生成 4 个角度的搜索词建议 | AI 不确定怎么构造搜索词时调用，返回 precise / action_oriented / fuzzy / concise 四个变体 |
| `get_wheel_details` | 拉取单个轮子的详情 | `find_wheel` 结果里带 `hasDetails: true` 标记时，按需调用拿到 README 摘要、代码示例、最新 release、license 兼容性 |
| `record_feedback` | 记录用户反馈 | AI 展示结果后，根据用户反应调用：点赞→`like`、说不相关→`hide`、点开链接→`click`。反馈持久化累积，影响后续搜索排序 |
| `search_knowledge` | 搜索本地 Markdown 知识库 | 用户问"团队文档/个人笔记/内部规范"时调用，搜索 Obsidian vault / Logseq / 任意 `.md` 文件夹。需配置 `FINDAWHEEL_KB_ENABLED=true` + `FINDAWHEEL_KB_ROOT=<path>` 才启用，详见 3.6 节 |

#### 混合呈现策略

`find_wheel` 返回结果时采用**混合呈现**，平衡信息量和响应速度：

- **top 3 结果**：内联 `details` 字段（README 前 30 行摘要、最多 2 个代码示例、最新 release tag、license 兼容性）。AI 可直接展示，无需二次调用。
- **top 4-10 结果**：加 `hasDetails: true` 标记，详情已预抓取并写入缓存。AI 想展示时调 `get_wheel_details`，**秒回**（命中缓存）。
- **top 11+ 结果**：无标记，需要时调 `get_wheel_details` 实时抓取。
- **非 GitHub 源**（npm/PyPI 等）：不加标记（无 README API）。
- **预抓取失败**：容错跳过，不阻断主搜索。

`get_wheel_details` 的缓存与 `find_wheel` 预抓取共享，避免重复抓取。

#### 反馈加权策略

AI 展示结果后，根据用户反应调 `record_feedback` 记录反馈。反馈持久化到 `~/.findawheel/feedback/`，跨会话累积，影响后续搜索排序：

| 动作 | 分值 | 累加上限 | 含义 |
|:-----|:-----|:-----|:-----|
| `like` | +0.2/次 | +1.0（5 次封顶） | 用户点赞/选用，后续搜索上浮 |
| `click` | +0.05/次 | +0.3（6 次封顶） | 用户点开查看，小幅加分 |
| `hide` | -0.5/次 | 无上限 | 用户说不相关，后续搜索下沉 |

反馈调整量叠加到 `matchScore` 上，调整后重新排序并重新分级推荐等级。结果的 `match` 字段会带 `feedbackDelta`（反馈调整量）。反馈变化后，搜索缓存（TTL 1h）自然刷新排序。

> ⚠️ **AI 客户端注意事项**：
> - 用户表达"我想做/建/创建一个..."时，**必须先调用 `find_wheel`** 再开始任何创意工作（头脑风暴/设计/规划/编码）
> - 不要把用户原话直接传入 query，应先理解意图后生成精准的英文搜索词
> - 不确定搜索词时，先调用 `suggest_queries` 获取建议
> - top 3 结果可直接展示 README 摘要和代码示例；带 `hasDetails: true` 的结果可告诉用户"需要更多详情请告诉我"
> - 用户对结果有明确反应时（点赞/说不相关/点开链接），调 `record_feedback` 记录，帮助后续搜索更精准
> - 用户问"团队文档/个人笔记/内部规范/我的 ADR"时，调 `search_knowledge`（需用户已配置 `FINDAWHEEL_KB_ENABLED=true`）。注意：`find_wheel` 找公开轮子，`search_knowledge` 找私人笔记，二者不混淆

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

#### 5.5.1 快速触发咒语（AI 没自动调用时用）

当 AI 该调用 findawheel 却没自动调时，用户可以用这些语句强制触发：

**默认咒语**（简短、含工具名，最可靠）：

| 中文 | 英文 |
|:-----|:-----|
| `findawheel 一下 XX` | `findawheel XX` |
| `用 findawheel 搜 XX` | `search findawheel for XX` |

**备选咒语**（"轮子"比喻，好记）：

| 中文 | 英文 |
|:-----|:-----|
| `帮我找一个 XX 的轮子` | `find me a wheel for XX` |
| `有没有 XX 的轮子` | `any wheel for XX` |

**强制咒语**（AI 跳过搜索直接编码时）：

| 中文 | 英文 |
|:-----|:-----|
| `先 findawheel 再写代码` | `findawheel first, then code` |
| `别直接写，先 findawheel` | `don't code yet, findawheel first` |

#### 5.5.2 换词重搜（搜完不满意）

分两种子场景：

**A. 让 AI 自动换词**（触发 `suggest_queries` 生成新词再搜）：

| 中文 | 英文 |
|:-----|:-----|
| `findawheel 换个词搜 XX` | `findawheel rephrase XX` |
| `用 suggest_queries 给 XX 造几个搜索词` | `suggest_queries for XX` |

**B. 用户指定新词**（直接给新关键词触发 `find_wheel`）：

| 中文 | 英文 |
|:-----|:-----|
| `findawheel 搜 YY` | `findawheel search YY` |
| `换个关键词 findawheel: YY` | `rephrase findawheel: YY` |

#### 5.5.3 排除重搜（配合 exclude 参数）

搜完发现某些项目不相关，想让 AI 二次筛选时用：

| 中文 | 英文 |
|:-----|:-----|
| `findawheel XX 但不要 YY` | `findawheel XX excluding YY` |

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

**说明**：这是预期行为。findawheel 内置 200+ 词的中英翻译表，会把中文 query 翻译成英文后再去 GitHub/npm/crates/Web 搜索，因为绝大多数开源项目用英文命名和描述。

**如果想要国内项目**：Gitee 源会用中文+英文联合搜索，国内项目会优先出现在 Gitee 结果中。

</details>

<details>
<summary><b>🇨🇳 国内网络环境能否使用?Exa/Tavily key 在哪申请?</b></summary>

**简短回答**：能用。findawheel 设计了降级机制，部分源失败不影响整体。Exa/Tavily 是可选的，不配也能跑。

**Exa / Tavily key 在哪添加**

两种方式：

*方式一：MCP 配置 GUI（推荐生产接入）*

在 Trae / Cursor / Claude Desktop 的 MCP 配置文件 `env` 字段添加：

```json
"env": {
  "EXA_API_KEY": "your_exa_key_here",
  "TAVILY_API_KEY": "your_tavily_key_here"
}
```

*方式二：.env 文件（仅开发时用）*

复制 `.env.example` 为 `.env`，填入 key。**注意：Trae 不会自动读取 .env**，生产接入必须用方式一。

**key 申请地址**：

| 服务 | 申请地址 | 免费额度 |
|:-----|:-----|:-----|
| Exa（主源，神经网络搜索） | https://exa.ai | 1000 次/月 |
| Tavily（兜底） | https://tavily.com | 1000 次/月 |

**国内有没有类似替代？**

直接答案：没有完全等价的国内 AI Web 搜索 API。Exa/Tavily 是专为 AI 优化的神经网络搜索，国内现状：

| 服务 | 状态 |
|:-----|:-----|
| Bing Web Search API | ❌ 2025-08 停服 |
| 百度搜索 API | ⚠️ 需企业认证，个人难用 |
| 搜狗搜索 API | ❌ 已停服 |
| 360 搜索 | ❌ 无公开 API |

**但好消息是**：findawheel 的核心价值在代码托管平台和包管理器，Web 搜索只是补充覆盖教程站/博客。

**12 个数据源的国内可达性**：

| 源 | 域名 | 国内可达 | 需要 key |
|:-----|:-----|:------:|:------:|
| Gitee | gitee.com | ✅ 国内 | 否 |
| npm | registry.npmjs.org | ✅ | 否 |
| crates.io | crates.io | ✅ | 否 |
| PyPI | pypi.org | ✅ | 否 |
| VS Code Marketplace | marketplace.visualstudio.com | ✅ | 否 |
| GitHub | api.github.com | ⚠️ 慢但通 | 可选 |
| GitLab | gitlab.com | ⚠️ 慢但通 | 可选 |
| Exa | api.exa.ai | ❌ 国外 | 必需 |
| Tavily | api.tavily.com | ❌ 国外 | 必需 |
| Libraries.io | libraries.io | ❌ 国外 | 必需 |
| HuggingFace | huggingface.co | ❌ 时通时断 | 否 |
| Papers with Code | paperswithcode.com | ❌ 国外 | 否 |
| GitHub Code Search | api.github.com | ⚠️ 同 GitHub | 必需 |

**纯国内网络下仍可用的源**：Gitee + npm + crates.io + PyPI + VS Code Marketplace + GitHub（慢但通）+ GitLab（慢但通）

**失去的**：Web 教程搜索、AI 模型、论文、多包管理器聚合

**替代方案**：

| 方案 | 说明 |
|:-----|:-----|
| **A. 零配置默认** | 所有 key 可选，不配 Exa/Tavily 时 WebSourceAdapter 返回空，findawheel 仍能用 GitHub/Gitee/npm/crates 等核心源 |
| **B. 配置 GitHub Token** | 强烈推荐。Token 后 GitHub 限流从 60/h 提到 5000/h，GitHub 是最大数据源，token 能极大提升体验 |
| **C. 开启磁盘缓存** | 默认已开，TTL 1 小时。相同 query 在 TTL 内不重复请求，减少对外网依赖 |
| **D. 配置代理** | 如本机有代理，在 MCP 配置 `env` 加 `HTTPS_PROXY=http://127.0.0.1:7890`，所有国外源都能访问 |
| **E. 内网完全隔离** | 只能用 Gitee + 缓存，搜索覆盖有限，但基础功能仍可用 |

**总结建议**：

| 场景 | 推荐配置 |
|:-----|:-----|
| 纯国内网络，不想折腾 | 只配 `GITHUB_TOKEN`（GitHub 慢但通），零配置也能用 |
| 有代理 | 配代理 + 全部 key，体验最佳 |
| 企业内网完全隔离 | 只能用 Gitee + 缓存，搜索覆盖有限 |

</details>

<details>
<summary><b>📝 FINDAWHEEL_USER_LICENSE 和 FINDAWHEEL_FEEDBACK_DIR 怎么填?</b></summary>

这两个环境变量都是**可选**的，留空即用默认值。

**`FINDAWHEEL_USER_LICENSE`**：你项目的 license SPDX ID

```bash
# 留空（默认，跳过 license 兼容性检查）
FINDAWHEEL_USER_LICENSE=

# 常见填法：
FINDAWHEEL_USER_LICENSE=MIT           # 最宽松，几乎所有都兼容
FINDAWHEEL_USER_LICENSE=Apache-2.0    # 宽松，但不兼容 GPLv2
FINDAWHEEL_USER_LICENSE=GPL-3.0       # 传染性，要求依赖也是 GPL
FINDAWHEEL_USER_LICENSE=BSD-2-Clause
FINDAWHEEL_USER_LICENSE=ISC
```

**填了之后的效果**：`find_wheel` 结果的 `details.licenseCheck` 字段会标注：
- `"compatible"` — 该 wheel 的 license 和你项目兼容
- `"incompatible"` — 不兼容（如你用 MIT，wheel 是 GPL-3.0）
- `"unknown"` — wheel 无 license 或 SPDX ID 无法识别

**建议**：个人项目填 `MIT`，企业项目按公司法务要求填。不确定就留空。

---

**`FINDAWHEEL_FEEDBACK_DIR`**：用户反馈存储目录

```bash
# 留空（默认 ~/.findawheel/feedback/，推荐）
FINDAWHEEL_FEEDBACK_DIR=

# 自定义路径（Windows 示例，注意双反斜杠）
FINDAWHEEL_FEEDBACK_DIR=D:\\mydata\\findawheel-feedback

# 自定义路径（macOS/Linux 示例）
FINDAWHEEL_FEEDBACK_DIR=/home/user/my-findawheel-feedback
```

**注意**：
- 留空时默认 `~/.findawheel/feedback/`（`~` 是用户主目录，Windows 是 `C:\Users\你的用户名\.findawheel\feedback\`）
- 目录不存在会自动创建
- **无 TTL**，反馈文件永久累积，直到手动删除
- 每个 wheel 一个 JSON 文件，很小（几百字节）

**建议**：留空用默认即可。只有需要把反馈数据放到其他位置（如 NAS 备份目录）时才填。

</details>

<details>
<summary><b>📚 search_knowledge 工具搜不到内容?知识库怎么配置?</b></summary>

**简短回答**：`search_knowledge` 是独立于 `find_wheel` 的工具，用于搜索本地 Markdown 知识库（Obsidian vault / Logseq / 任意 `.md` 文件夹）。需要显式开启才会生效。

**配置步骤**：

1. 找到你的知识库根目录路径（如 `D:\Notes\MyVault` 或 `/home/user/Documents/ObsidianVault`）
2. 在 MCP 配置的 `env` 字段添加两个变量：
   ```json
   "env": {
     "FINDAWHEEL_KB_ENABLED": "true",
     "FINDAWHEEL_KB_ROOT": "D:\\Notes\\MyVault"
   }
   ```
3. 重启 AI 客户端，配置才会生效
4. 在对话中问："我的笔记里有没有 redis 相关的"

**多知识库支持**：`FINDAWHEEL_KB_ROOT` 支持逗号分隔多个路径：
```json
"FINDAWHEEL_KB_ROOT": "D:\\Notes\\MyVault,E:\\TeamWiki"
```

**搜不到内容的常见原因**：

| 原因 | 排查方法 |
|:-----|:-----|
| `FINDAWHEEL_KB_ENABLED` 未设为 `true` | 检查 MCP 配置 env 字段，**必须显式开启** |
| `FINDAWHEEL_KB_ROOT` 路径错误 | 路径必须是存在的目录；Windows 用 `\\` 双反斜杠 |
| 文件不是 `.md` 后缀 | 只支持 Markdown，不支持 `.txt` / `.org` / `.docx` |
| 文件超过 100KB | 默认跳过大文件，可用 `FINDAWHEEL_KB_MAX_FILE_KB=500` 调整上限 |
| 知识库在隐藏目录下 | `.git` / `.obsidian` / `.trash` 等隐藏目录会被跳过 |
| 搜索词未命中 | 搜索字段优先级 `title > path > tag > content`，可放宽查询词 |

**Markdown 标签提取规则**：

支持两种标签格式，都会被提取为 `tags` 字段：

```markdown
---
# YAML frontmatter 格式（数组或多行都支持）
tags: [architecture, decision]
categories: [kubernetes, deploy]
---

# 文档标题

正文里也可以写 inline #backend #security 标签
```

**是否启用缓存**：

默认 `FINDAWHEEL_KB_CACHE_ENABLED=false`，每次搜索都重新扫描磁盘（保证最新）。如果你的知识库很大（数千文件），可以开启缓存：
```json
"FINDAWHEEL_KB_CACHE_ENABLED": "true"
```
开启后会走 findawheel 主缓存（TTL 1 小时），搜索更快但可能略有过期。

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
