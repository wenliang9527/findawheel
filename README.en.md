<div align="center">

# 🔍 findawheel

### An AI-era "find the wheel" assistant

> Discover existing wheels before you start coding.

[![Language](https://img.shields.io/badge/lang-中文-blue.svg?style=flat-square)](./README.md)
[![Node](https://img.shields.io/badge/Node.js-≥18-green.svg?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-1.29-orange.svg?style=flat-square)](https://modelcontextprotocol.io/)
[![Build](https://img.shields.io/badge/build-passing-brightgreen.svg?style=flat-square)](./)
[![Tests](https://img.shields.io/badge/tests-664%2F664-brightgreen.svg?style=flat-square)](./)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](./LICENSE)

</div>

---

## 📖 Table of Contents

| | Section | Description |
|:---:|:-----|:-----|
| 🎯 | [Introduction](#-introduction) | What is findawheel |
| 🤔 | [Why](#-why) | The problem it solves |
| ✨ | [Core Features](#-core-features) | Eight capabilities |
| 🚀 | [Quick Start](#-quick-start) | Three steps |
| ⚡ | [Quick Trigger](#-quick-trigger-user-spells) | Force-trigger when AI doesn't auto-call |
| 🤖 | [Connect to AI Client](#-connect-to-ai-client) | Trae / Cursor / Claude |
| 🔧 | [Environment Variables](#-environment-variables) | Configuration |
| 🏗️ | [Architecture](#-architecture) | Data flow diagram |
| 🛠️ | [Development](#-development) | Command reference |
| 🌐 | [Data Sources](#-data-sources) | Coverage |
| 🧰 | [Provided Tools](#-provided-tools) | find_wheel + suggest_queries |
| 🗺️ | [Roadmap](#-roadmap) | Evolution plan |
| 📚 | [Further Reading](#-further-reading) | Detailed docs |

---

## 🎯 Introduction

`findawheel` is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) service. Before you start implementing a new idea, it searches the web for existing reusable wheels — open-source projects, npm/crates packages, APIs, CLI tools, SDKs — so you don't have to reinvent them.

> 💡 **RAG paradigm positioning**
>
> findawheel is an "context enhancer" for AI coding: **the retriever only recalls, the AI does the judging**.
> AI clients must call `find_wheel` before implementing any new feature/module/idea, then decide whether to reuse directly, reference the implementation, or build from scratch. findawheel does NOT do hard relevance filtering — mainstream libraries like Neutree/COMTool won't be mistakenly killed by rules; the AI gets raw stars/description/lastUpdated values and judges for itself.

> 💡 **Use case**
>
> When you tell your AI, "I want to build a Markdown-to-PDF tool," the AI first calls `findawheel` to find existing implementations and then recommends whether to reuse one.

---

## 🤔 Why

In the AI-coding era, everyone can quickly turn ideas into code. But many "new ideas" have already been built by someone else. The result: a lot of time wasted reinventing wheels.

`findawheel` adds one step before implementation:

```
 ┌──────────┐      ┌──────────────────┐      ┌────────────────────┐
 │   Idea    │ ──→ │ Search existing  │ ──→ │ Reuse or build self │
 │           │     │     wheels       │     │                     │
 └──────────┘      └──────────────────┘      └────────────────────┘
```

---

## ✨ Core Features

| Icon | Feature | Description |
|:---:|:-----|:-----|
| 🔎 | **Multi-source search** | GitHub, Gitee, npm, crates.io, and Web (Exa + Tavily) simultaneously |
| 🧠 | **Intent detection** | Auto-classifies query as feature-level or project-level; splits into core words / modifiers / format words |
| 📊 | **Unified model** | Normalizes all sources into a single `Wheel` structure with recommendation level and reason |
| 🏆 | **Soft ranking signals** | Relevance + stars + activity + downloads + license + description match; **NO hard filtering** — relevance judgment left to the AI |
| 🛡️ | **Basic filtering** | Only drops archived / stale / awesome-lists; reverse-intent / core-word-missing cases are identified by the AI itself |
| ⚡ | **Graceful degradation** | Source failure doesn't block others; Web source falls back from Exa to Tavily |
| 🌏 | **CJK friendly** | 250+ word Chinese↔English translation table (incl. Chinese internet platforms like 小红书→xiaohongshu/rednote and embedded motion-control terms like s型加减速→s-curve-acceleration); Chinese queries are auto-translated |
| 📝 | **RAG workflow** | Tool descriptions specify "WHEN TO CALL / WHY SEARCH FIRST" — the AI must search before coding |

---

## 🚀 Quick Start

```bash
# 1. Clone
git clone <repo-url> findawheel
cd findawheel

# 2. Install dependencies
npm install

# 3. Build
npm run build
```

> 📖 Full installation guide: [USAGE.md](./docs/USAGE.md)

---

## ⚡ Quick Trigger (User Spells)

When the AI should call findawheel but doesn't, users can force-trigger it with these phrases:

**Default spells** (short, contain tool name — most reliable):
- `findawheel XX`
- `search findawheel for XX`

**Alternative spells** ("wheel" metaphor — easy to remember):
- `find me a wheel for XX`
- `any wheel for XX`

**Force spells** (when AI skips search and goes straight to coding):
- `findawheel first, then code`
- `don't code yet, findawheel first`

> 📖 Advanced usage (rephrase search, exclude search) in [USAGE.md FAQ](./docs/USAGE.md#faq)

---

## 🤖 Connect to AI Client

Add this to your MCP-compatible client config (Trae / Cursor / Claude Desktop):

```json
{
  "mcpServers": {
    "findawheel": {
      "command": "node",
      "args": ["/absolute/path/to/findawheel/dist/index.js"],
      "env": {
        "GITHUB_TOKEN": "optional but recommended",
        "EXA_API_KEY": "optional, enables neural Web search (primary)",
        "TAVILY_API_KEY": "optional, Web search fallback",
        "GITLAB_TOKEN": "optional, improves GitLab rate limit",
        "GITEE_TOKEN": "optional, improves Gitee rate limit",
        "LIBRARIES_IO_API_KEY": "optional, enables 30+ package manager search"
      }
    }
  }
}
```

Restart your client, describe your idea in conversation, and the AI will automatically call `find_wheel`.

---

## 🔧 Environment Variables

| Variable | Required | Default | Description |
|:---------|:---:|:------:|:-----|
| `GITHUB_TOKEN` | no | — | GitHub PAT. Without it, 60 req/h limit; with it, 5000 req/h. |
| `EXA_API_KEY` | no | — | Exa API key, enables neural Web search (primary source). [Get one](https://exa.ai) |
| `TAVILY_API_KEY` | no | — | Tavily API key, Web search fallback (used when Exa fails or quota is exhausted). [Get one](https://tavily.com) |
| `GITLAB_TOKEN` | No | — | GitLab token (optional, improves GitLab rate limit; anonymous search works without it). |
| `GITEE_TOKEN` | No | — | Gitee token (optional, improves Gitee rate limit: 60/hour anonymous → 5000/hour authenticated; anonymous search works without it). [Get one](https://gitee.com/profile/personal_access_tokens) |
| `LIBRARIES_IO_API_KEY` | No | — | Libraries.io API key, enables multi-package-manager search (covers npm/pypi/rubygems/cargo/maven and 30+ platforms). [Get one](https://libraries.io/account) |
| `FINDAWHEEL_USER_LICENSE` | No | — | Your project's license (e.g., `MIT`/`Apache-2.0`/`GPL-3.0`). When set, each wheel's details include a `licenseCheck` field showing whether its license is compatible with yours (avoids license contamination). |
| `FINDAWHEEL_CACHE_ENABLED` | No | `true` | Enable local cache (`~/.findawheel/cache/`). Set to `false` to disable. |
| `FINDAWHEEL_FEEDBACK_DIR` | No | `~/.findawheel/feedback/` | Feedback storage directory. Persists user feedback (like/hide/click) across sessions to adjust search ranking. No TTL — clear manually. |
| `FINDAWHEEL_CACHE_TTL_MS` | No | `3600000` | Cache TTL in milliseconds, default 1 hour. |
| `FINDAWHEEL_LIMIT` | no | `50` | Default result count. |
| `FINDAWHEEL_TIMEOUT_MS` | no | `8000` | Per-source timeout (ms). |
| `FINDAWHEEL_LOG_LEVEL` | no | `info` | `error` \| `warn` \| `info` \| `debug`. |
| `FINDAWHEEL_KB_ENABLED` | No | `false` | Enable the `search_knowledge` tool (searches local Markdown knowledge base). When `true`, also set `FINDAWHEEL_KB_ROOT`. See [USAGE.md §3.6](./docs/USAGE.md). |
| `FINDAWHEEL_KB_ROOT` | No | — | Knowledge base root directory (comma-separated for multiple vaults). E.g., `/path/to/obsidian-vault` or `D:\notes,D:\docs`. Only effective when `FINDAWHEEL_KB_ENABLED=true`. |
| `FINDAWHEEL_KB_MAX_FILE_KB` | No | `100` | Max single .md file size in KB; larger files are skipped to keep scanning fast. |
| `FINDAWHEEL_KB_CACHE_ENABLED` | No | `false` | Enable knowledge base search cache (shares `cacheDir` with `find_wheel` but with isolated `kb:` key prefix). TTL follows `FINDAWHEEL_CACHE_TTL_MS`. |

---

## 🏗️ Architecture

```
              AI calls find_wheel(query) or suggest_queries(query)
                            │
                            ▼
                  ┌─────────────────────┐
                  │  QueryParser        │  ← splits core/modifier/format words (no antonyms)
                  │  + QueryClassifier  │  ← decides feature vs project
                  └─────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │ Main search   │ │ Fuzzy search  │ │              │
    │ (precise q)   │ │ (synonyms)    │ │              │
    └──────┬───────┘ └──────┬───────┘ │              │
           └────────┬───────┘         │              │
                    ▼                 │              │
    ┌─────────────────────────────────────────────┐  │
    │  GitHub · Gitee · npm · crates · GitLab · PyPI · Libraries.io · GitHub Code · VS Code Market · Papers with Code · HuggingFace · Web    │  │
    │     (Exa primary + Tavily fallback)         │  │
    └─────────────────────┬───────────────────────┘  │
                          ▼                          │
            ┌──────────────────────────────────┐    │
            │  Normalizer → MetricsEnricher    │    │
            │  → Recommender → Ranker          │    │
            │  (normalize + metrics + recommend │    │
            │   + soft ranking)                │    │
            └──────────────────────────────────┘    │
                          ▼                          │
                  Wheel[] + summary returned ───────┘
                            │
                            ▼
            AI judges relevance itself, picks best 2-3 to recommend
            (findawheel does NOT hard-filter; judgment is on the AI)
```

> 📖 Full internals: [HOW_IT_WORKS.md](./docs/HOW_IT_WORKS.md)

---

## 🛠️ Development

| Command | Description |
|:-----|:-----|
| `npm run dev` | tsc --watch |
| `npm test` | Run all tests |
| `npm run test:watch` | Tests in watch mode |
| `npm run build` | Build to dist/ |

---

## 🌐 Data Sources

| Source | Type | Token needed | Notes |
|:------|:-----|:-----|:-----|
| **GitHub** | Open-source repos | optional | `/search/repositories`; supports quoted phrases for precise matching (single word unquoted, multi-word quoted) |
| **Gitee** | Chinese open-source repos | no | Covers domestic projects; fast access from inside China |
| **npm** | JavaScript packages | no | Auto-enriched with stars + weekly downloads |
| **crates.io** | Rust packages | no | Returns downloads; richest metrics |
| **Web (Exa)** | Pages / tutorials / tool sites | API key required | Neural search, code-semantic friendly (primary) |
| **Web (Tavily)** | Pages / tutorials / tool sites | API key required | Auto-fallback when Exa fails / quota exhausted |
| **GitLab** | Open-source repos | Optional | `/api/v4/projects`, complements non-GitHub hosted projects |
| **PyPI** | Python packages | Not required | Parses `pypi.org/search` HTML; top 10 auto-enriched with GitHub stars (requires `GITHUB_TOKEN`) |
| **Libraries.io** | Multi-platform packages | API key required | One query covers 30+ package managers (npm/pypi/cargo/maven...) |
| **GitHub Code** | Code snippets | reuses `GITHUB_TOKEN` | `/search/code`, searches code snippets instead of repos; auth required, 10 req/min rate limit; returns `textFragment` with matched code |
| **VS Code Marketplace** | IDE extensions | not required | `extensionquery` POST API, searches VS Code extensions; returns install count/rating; unofficially-documented API |
| **Papers with Code** | Papers / algorithms | not required | `/api/v1/papers/`, searches papers and algorithm implementations; returns title/abstract/year/arxiv link; fills the algorithm gap |
| **HuggingFace Hub** | AI models | not required | `/api/models?search=...`, searches pretrained models; returns likes/downloads/task type; fills the AI model gap |
| **Maven Central** | Java/Kotlin packages | not required | `search.maven.org/solrsearch/select`, searches Java/Kotlin artifacts; returns groupId/artifactId/timestamp |
| **RubyGems** | Ruby gems | not required | `rubygems.org/api/v1/search.json`, searches Ruby gems; returns downloads/version/license |
| **pkg.go.dev** | Go modules | not required | Parses `pkg.go.dev/search` HTML, searches Go modules; no official JSON API |

> ℹ️ **PyPI strategy**: PyPI has no official search JSON API. We parse the HTML of `pypi.org/search` to extract package info; top 10 results are auto-enriched by querying the PyPI JSON API for `home_page`, and if it points to GitHub we fetch GitHub API for stars (requires `GITHUB_TOKEN`; skipped without token).
>
> ℹ️ **pkg.go.dev strategy**: No official JSON API; we parse `pkg.go.dev/search` HTML to extract module info (similar to the PyPI pattern).
>
> ℹ️ **Zero-config Web search**: If you don't want to sign up for Exa/Tavily keys, you can additionally enable the [Open-WebSearch MCP](https://github.com/OpenWebSearch) — the AI will orchestrate it automatically.

---

## 🧰 Provided Tools

| Tool | Purpose | When to call |
|:-----|:-----|:-----|
| `find_wheel` | Search for existing wheels | **Mandatory trigger**: when the user says "I want to make/build/create/implement a ..." call this **first** — search before coding (RAG paradigm) |
| `suggest_queries` | Generate 4 search-term variants | Call when the AI is unsure how to construct the query; returns precise / action-oriented / fuzzy / concise variants |
| `get_wheel_details` | Fetch details for a single wheel | When a `find_wheel` result has `hasDetails: true`, call this on demand to get README snippet, code examples, latest release, and license compatibility |
| `record_feedback` | Record user feedback | After showing results, call based on user reaction: praise→`like`, irrelevant→`hide`, opened link→`click`. Feedback persists and adjusts future search ranking |
| `search_knowledge` | Search local Markdown knowledge base | Call when user asks about "team docs / personal notes / internal conventions". Searches Obsidian vault / Logseq / any `.md` folders. Requires `FINDAWHEEL_KB_ENABLED=true` + `FINDAWHEEL_KB_ROOT=<path>` (disabled by default). See [USAGE.md §3.6](./docs/USAGE.md) |

> 💡 **RAG workflow (encoded in tool descriptions)**
>
> The `find_wheel` and `suggest_queries` description fields include structured prompts:
> - **WHEN TO CALL**: must call first when new feature / new module / new project / new idea triggers appear
> - **WHY SEARCH FIRST**: 4 AI failure modes (hallucinated libraries / outdated APIs / reinventing the wheel / picking the wrong library)
> - **WORKFLOW**: suggest_queries → find_wheel → compare top 5 and recommend 2-3 → code
> - **Key declaration**: findawheel **does NOT hard-filter relevance** — the AI must identify irrelevant results itself (e.g., reverse-intent "remove watermark")

### Hybrid Presentation (Result Richness)

`find_wheel` uses a **hybrid presentation** strategy to balance information density and response speed:

- **Top 3 results**: inline `details` field with README snippet (first 30 lines), up to 2 code examples, latest release tag, and license compatibility check. The AI can show these directly without a second call.
- **Top 4-10 results**: marked with `hasDetails: true`, meaning details were pre-fetched and cached. When the AI wants to show them, it calls `get_wheel_details` for an **instant** cache hit.
- **Top 11+ results**: unmarked; `get_wheel_details` will fetch them live when needed.
- **Non-GitHub sources** (npm/PyPI etc.): unmarked (no README API).
- **Pre-fetch failures**: tolerated and skipped; the main search flow is never blocked.

`get_wheel_details` shares its cache with `find_wheel`'s pre-fetch, avoiding duplicate fetches. Configure `FINDAWHEEL_USER_LICENSE` to add a `licenseCheck` field to each wheel's details.

### Feedback Weighting (Search Quality)

After showing results, the AI calls `record_feedback` based on the user's reaction. Feedback persists to `~/.findawheel/feedback/`, accumulates across sessions, and adjusts future search ranking:

| Action | Score | Accumulation cap | Meaning |
|:-----|:-----|:-----|:-----|
| `like` | +0.2 each | +1.0 (caps at 5) | User praised/selected — boosts future ranking |
| `click` | +0.05 each | +0.3 (caps at 6) | User opened the link — small boost |
| `hide` | -0.5 each | no cap | User said irrelevant — demotes future ranking |

The feedback delta is added to `matchScore`, then results are re-sorted and re-graded. The `match` field includes `feedbackDelta` (the adjustment amount — positive means boost, negative means demote). Feedback changes refresh naturally via search cache TTL (1h).

---

## 📚 Further Reading

| Document | Description |
|:-----|:-----|
| 📖 [Usage Guide](./docs/USAGE.md) | Download, install, configure, and use |
| ⚙️ [How It Works](./docs/HOW_IT_WORKS.md) | Internal architecture and components |

---

## 📄 License

[MIT](./LICENSE)

---

<div align="center">

<sub>Found a bug or have a suggestion? Open an issue.</sub>

**[🌐 中文版本](./README.md)**

</div>

<!--
SEO Keywords (hidden comment for search engine discoverability):

Tool type:
MCP server, Model Context Protocol, AI coding assistant, code search tool, library finder, package discovery tool, dependency finder

Core features:
avoid reinventing the wheel, find existing wheel, library search, code reuse, open-source discovery, package search, dependency discovery

Use cases:
AI coding, generative development, vibe coding, RAG, retrieval-augmented generation, Trae, Cursor, Claude Desktop, Claude Code, Windsurf, Cline, AI pair programming

Data sources / ecosystem:
GitHub search, npm search, PyPI search, crates.io search, Maven Central, RubyGems, pkg.go.dev, Gitee, GitLab, Libraries.io, GitHub Code Search, VS Code Marketplace, Papers with Code, HuggingFace, Exa, Tavily, multi-source search, 15 data sources

Synonyms / long-tail:
wheel finder, library finder, dependency discovery, avoid duplicating code, how to find existing library, AI coding search tool

Multilingual:
找轮子, 避免重复造轮子, AI 编程助手, 代码搜索工具, MCP 服务
-->

