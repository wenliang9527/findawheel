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
        "TAVILY_API_KEY": "optional, Web search fallback",
        "GITLAB_TOKEN": "optional, improves GitLab rate limit",
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
| `LIBRARIES_IO_API_KEY` | No | — | Libraries.io API key, enables multi-package-manager search (covers npm/pypi/rubygems/cargo/maven and 30+ platforms). [Get one](https://libraries.io/account) |
| `FINDAWHEEL_USER_LICENSE` | No | — | Your project's license (e.g., `MIT`/`Apache-2.0`/`GPL-3.0`). When set, each wheel's details include a `licenseCheck` field showing whether its license is compatible with yours (avoids license contamination). |
| `FINDAWHEEL_CACHE_ENABLED` | No | `true` | Enable local cache (`~/.findawheel/cache/`). Set to `false` to disable. |
| `FINDAWHEEL_FEEDBACK_DIR` | No | `~/.findawheel/feedback/` | Feedback storage directory. Persists user feedback (like/hide/click) across sessions to adjust search ranking. No TTL — clear manually. |
| `FINDAWHEEL_CACHE_TTL_MS` | No | `3600000` | Cache TTL in milliseconds, default 1 hour. |
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
    │  GitHub · Gitee · npm · crates · GitLab · PyPI · Libraries.io · GitHub Code · VS Code Market · Web    │  │
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
| **GitLab** | Open-source repos | Optional | `/api/v4/projects`, complements non-GitHub hosted projects |
| **PyPI** | Python packages | Not required | Parses `pypi.org/search` HTML, no stars/downloads data |
| **Libraries.io** | Multi-platform packages | API key required | One query covers 30+ package managers (npm/pypi/cargo/maven...) |
| **GitHub Code** | Code snippets | reuses `GITHUB_TOKEN` | `/search/code`, searches code snippets instead of repos; auth required, 10 req/min rate limit; returns `textFragment` with matched code |
| **VS Code Marketplace** | IDE extensions | not required | `extensionquery` POST API, searches VS Code extensions; returns install count/rating; unofficially-documented API |

> ℹ️ **PyPI strategy**: PyPI has no official search JSON API. We parse the HTML of `pypi.org/search` to extract package info (no stars/downloads data).
>
> ℹ️ **Zero-config Web search**: If you don't want to sign up for Exa/Tavily keys, you can additionally enable the [Open-WebSearch MCP](https://github.com/OpenWebSearch) — the AI will orchestrate it automatically.

---

## 🧰 Provided Tools

| Tool | Purpose | When to call |
|:-----|:-----|:-----|
| `find_wheel` | Search for existing wheels | **First action** when the user says "I want to make/build/create a ..." |
| `suggest_queries` | Generate 4 search-term variants | Call when the AI is unsure how to construct the query; returns precise / action-oriented / fuzzy / concise variants |
| `get_wheel_details` | Fetch details for a single wheel | When a `find_wheel` result has `hasDetails: true`, call this on demand to get README snippet, code examples, latest release, and license compatibility |
| `record_feedback` | Record user feedback | After showing results, call based on user reaction: praise→`like`, irrelevant→`hide`, opened link→`click`. Feedback persists and adjusts future search ranking |

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

### 🚧 Phase 3 (Planned, stdio local service stays)

Three batches — see [Phase 3 plan](./docs/superpowers/plans/2026-07-03-phase3.md).

**✅ Batch 3.1 — Reliability foundation + data source expansion (completed)**
- [x] Local cache layer (`~/.findawheel/cache/`, TTL 1h, on by default)
- [x] Exponential backoff retry for transient errors (5xx/network, not 4xx)
- [x] In-flight request dedup
- [x] GitLab standalone source
- [x] PyPI source (HTML parsing)
- [x] Libraries.io source (covers 30+ package managers)

**✅ Batch 3.2 — Richer result info (Done)**
- [x] README snippet fetch (GitHub README API, first 30 lines)
- [x] Code example extraction (priority: bash install > js/ts/python > others)
- [x] Version + latest release time (GitHub Releases API)
- [x] License compatibility hints (normalize case variants + compatibility matrix)
- [x] Hybrid presentation: top 3 inline details + top 4-10 pre-fetched cache + `get_wheel_details` lazy-load tool

**✅ Batch 3.3 — Search quality (Done)**
- [x] Local feedback storage (`~/.findawheel/feedback/`, like/hide/click, JSON persistence, no TTL)
- [x] `record_feedback` MCP tool (AI records feedback based on user reaction)
- [x] Feedback-weighted ranking (like +0.2/click +0.05/hide -0.5, accumulation caps, re-sort + re-grade)
- [x] `feedbackDelta` field (shows feedback adjustment in results, transparent and auditable)
- [~] ML scoring model (deferred per YAGNI; will evaluate after real feedback data accumulates)

---

## 📚 Further Reading

| Document | Description |
|:-----|:-----|
| 📖 [Usage Guide](./docs/USAGE.md) | Download, install, configure, and use |
| ⚙️ [How It Works](./docs/HOW_IT_WORKS.md) | Internal architecture and components |
| 📐 [Design Spec](./docs/superpowers/specs/2026-07-02-findawheel-design.md) | Full design decisions |
| 📝 [Implementation Plan](./docs/superpowers/plans/2026-07-02-findawheel.md) | 16 TDD tasks |
| 🚀 [Phase 3 Plan](./docs/superpowers/plans/2026-07-03-phase3.md) | Three-batch evolution plan |

---

## 📄 License

[MIT](./LICENSE)

---

<div align="center">

<sub>Found a bug or have a suggestion? Open an issue.</sub>

**[🌐 中文版本](./README.md)**

</div>
