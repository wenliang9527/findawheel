<div align="center">

# 🔍 findawheel

### An AI-era "find the wheel" assistant

> Discover existing wheels before you start coding.

[![Language](https://img.shields.io/badge/lang-中文-blue.svg?style=flat-square)](./README.md)
[![Node](https://img.shields.io/badge/Node.js-≥18-green.svg?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-1.29-orange.svg?style=flat-square)](https://modelcontextprotocol.io/)
[![Build](https://img.shields.io/badge/build-passing-brightgreen.svg?style=flat-square)](./)
[![Tests](https://img.shields.io/badge/tests-106%2F106-brightgreen.svg?style=flat-square)](./)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](./LICENSE)

</div>

---

## 📖 Table of Contents

| | Section | Description |
|:---:|:-----|:-----|
| 🎯 | [Introduction](#-introduction) | What is findawheel |
| 🤔 | [Why](#-why) | The problem it solves |
| ✨ | [Core Features](#-core-features) | Seven capabilities |
| 🚀 | [Quick Start](#-quick-start) | Three steps |
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
| 🧠 | **Intent detection** | Auto-classifies query as feature-level or project-level; splits into core words / modifiers / antonyms |
| 📊 | **Unified model** | Normalizes all sources into a single `Wheel` structure with recommendation level and reason |
| 🏆 | **Quality ranking** | Relevance + stars + activity + downloads + license + description match |
| 🛡️ | **Smart filtering** | Drops archived / stale / awesome-lists / reverse-intent / core-word-missing results |
| ⚡ | **Graceful degradation** | Source failure doesn't block others; Web source falls back from Exa to Tavily |
| 🌏 | **CJK friendly** | 50+ word Chinese↔English translation table; Chinese queries are auto-translated |

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
        "TAVILY_API_KEY": "optional, Web search fallback"
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
| `FINDAWHEEL_LIMIT` | no | `20` | Default result count. |
| `FINDAWHEEL_TIMEOUT_MS` | no | `8000` | Per-source timeout (ms). |
| `FINDAWHEEL_LOG_LEVEL` | no | `info` | `error` \| `warn` \| `info` \| `debug`. |

---

## 🏗️ Architecture

```
              AI calls find_wheel(query) or suggest_queries(query)
                            │
                            ▼
                  ┌─────────────────────┐
                  │  QueryParser        │  ← splits core/modifier/antonym/format words
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
    │  GitHub · Gitee · npm · crates.io · Web    │  │
    │     (Exa primary + Tavily fallback)         │  │
    └─────────────────────┬───────────────────────┘  │
                          ▼                          │
            ┌──────────────────────────────────┐    │
            │  Normalizer → MetricsEnricher    │    │
            │  → Recommender → Ranker          │    │
            │  (normalize + metrics + recommend │    │
            │   + filter + rank)               │    │
            └──────────────────────────────────┘    │
                          ▼                          │
                  Wheel[] + summary returned ───────┘
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
| **GitHub** | Open-source repos | optional | `/search/repositories`; supports quoted phrases and `NOT` antonym exclusion |
| **Gitee** | Chinese open-source repos | no | Covers domestic projects; fast access from inside China |
| **npm** | JavaScript packages | no | Auto-enriched with stars + weekly downloads |
| **crates.io** | Rust packages | no | Returns downloads; richest metrics |
| **Web (Exa)** | Pages / tutorials / tool sites | API key required | Neural search, code-semantic friendly (primary) |
| **Web (Tavily)** | Pages / tutorials / tool sites | API key required | Auto-fallback when Exa fails / quota exhausted |

> ℹ️ **PyPI strategy**: PyPI has no official search API; Python ecosystem is covered via GitHub `language:Python`.
>
> ℹ️ **Zero-config Web search**: If you don't want to sign up for Exa/Tavily keys, you can additionally enable the [Open-WebSearch MCP](https://github.com/OpenWebSearch) — the AI will orchestrate it automatically.

---

## 🧰 Provided Tools

| Tool | Purpose | When to call |
|:-----|:-----|:-----|
| `find_wheel` | Search for existing wheels | **First action** when the user says "I want to make/build/create a ..." |
| `suggest_queries` | Generate 4 search-term variants | Call when the AI is unsure how to construct the query; returns precise / action-oriented / fuzzy / concise variants |

---

## 🗺️ Roadmap

### ✅ Phase 1 (Done)

- [x] GitHub + npm + crates.io search
- [x] Intent classification and quality ranking
- [x] Multi-source degradation and error handling

### ✅ Phase 2 (Done)

- [x] **Gitee source** — domestic open-source coverage
- [x] **Web source (Exa primary + Tavily fallback)** — neural search + fallback
- [x] **npm enriched with stars + weekly downloads** — more accurate ranking
- [x] **Chinese translation table** — 50+ word Chinese↔English mapping
- [x] **Quoted core-word mandatory match + `NOT` antonym exclusion** — higher GitHub precision
- [x] **Ranker multi-filter** — reverse-intent / core-word-missing / format-word-missing filters
- [x] **Recommendation levels** — each result tagged `highly_recommended` / `recommended` / `optional` / `not_recommended` with reason
- [x] **suggest_queries tool** — 4 search-term variants
- [x] **Synonym fuzzy secondary search** — main + fuzzy searches run in parallel for broader recall

### 🚧 Phase 3 (Planned)

- [ ] Result caching and retry logic
- [ ] ML-based scoring tuning
- [ ] Standalone GitLab / PyPI (HTML scraping) sources
- [ ] Multi-user, auth, and server-side hosting

---

## 📚 Further Reading

| Document | Description |
|:-----|:-----|
| 📖 [Usage Guide](./docs/USAGE.md) | Download, install, configure, and use |
| ⚙️ [How It Works](./docs/HOW_IT_WORKS.md) | Internal architecture and components |
| 📐 [Design Spec](./docs/superpowers/specs/2026-07-02-findawheel-design.md) | Full design decisions |
| 📝 [Implementation Plan](./docs/superpowers/plans/2026-07-02-findawheel.md) | 16 TDD tasks |

---

## 📄 License

[MIT](./LICENSE)

---

<div align="center">

<sub>Found a bug or have a suggestion? Open an issue.</sub>

**[🌐 中文版本](./README.md)**

</div>
