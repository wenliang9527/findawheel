<div align="center">

# 🔍 findawheel

### An AI-era "find the wheel" assistant

> Discover existing wheels before you start coding.

[![Language](https://img.shields.io/badge/lang-中文-blue.svg?style=flat-square)](./README.md)
[![Node](https://img.shields.io/badge/Node.js-≥18-green.svg?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-1.29-orange.svg?style=flat-square)](https://modelcontextprotocol.io/)
[![Build](https://img.shields.io/badge/build-passing-brightgreen.svg?style=flat-square)](./)
[![Tests](https://img.shields.io/badge/tests-46%2F46-brightgreen.svg?style=flat-square)](./)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](./LICENSE)

</div>

---

## 📖 Table of Contents

| | Section | Description |
|:---:|:-----|:-----|
| 🎯 | [Introduction](#-introduction) | What is findawheel |
| 🤔 | [Why](#-why) | The problem it solves |
| ✨ | [Core Features](#-core-features) | Six capabilities |
| 🚀 | [Quick Start](#-quick-start) | Three steps |
| 🤖 | [Connect to AI Client](#-connect-to-ai-client) | Trae / Cursor / Claude |
| 🔧 | [Environment Variables](#-environment-variables) | Configuration |
| 🏗️ | [Architecture](#-architecture) | Data flow diagram |
| 🛠️ | [Development](#-development) | Command reference |
| 🌐 | [Data Sources](#-data-sources) | Phase 1 coverage |
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
| 🔎 | **Multi-source search** | GitHub, npm, and crates.io simultaneously |
| 🧠 | **Intent detection** | Auto-classifies query as feature-level or project-level |
| 📊 | **Unified model** | Normalizes all sources into a single `Wheel` structure |
| 🏆 | **Quality ranking** | stars / recency / activity / downloads / license |
| 🛡️ | **Auto filtering** | Drops archived, stale, or low-info results |
| ⚡ | **Graceful degradation** | Source failure doesn't block the others |

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
        "GITHUB_TOKEN": "optional-but-recommended"
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
| `GITHUB_TOKEN` | no | — | GitHub PAT. Without it, 60 req/h limit. |
| `FINDAWHEEL_LIMIT` | no | `10` | Default result count. |
| `FINDAWHEEL_TIMEOUT_MS` | no | `8000` | Per-source timeout (ms). |
| `FINDAWHEEL_LOG_LEVEL` | no | `info` | `error` \| `warn` \| `info` \| `debug`. |

---

## 🏗️ Architecture

```
                  AI calls find_wheel(query)
                            │
                            ▼
                  ┌─────────────────────┐
                  │  QueryClassifier    │  ← decides feature vs project
                  └─────────────────────┘
                            │
                            ▼
                  ┌─────────────────────┐
                  │   SourceAdapters    │  ← GitHub / npm / crates.io parallel search
                  └─────────────────────┘
                            │
                            ▼
            ┌──────────────────────────────────┐
            │  Normalizer → MetricsEnricher    │  ← normalize + enrich metrics
            │           → Ranker               │  ← filter + score + dedupe
            └──────────────────────────────────┘
                            │
                            ▼
                    Wheel[] returned to AI
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

| Source | Type | Notes |
|:------|:-----|:-----|
| **GitHub** | Open-source repos | `/search/repositories`, sorted by stars |
| **npm** | JavaScript packages | registry search |
| **crates.io** | Rust packages | crates search |

> ℹ️ PyPI has no official search API; Python packages are covered via GitHub mirrors in Phase 1. Phase 2 will add a generic web search source (Exa / Brave).

---

## 🗺️ Roadmap

### ✅ Phase 1 (Done)

- [x] GitHub + npm + crates.io search
- [x] Intent classification and quality ranking
- [x] Multi-source degradation and error handling

### 🚧 Phase 2 (Planned)

- [ ] Web search source (Exa / Brave)
- [ ] Result caching and retry logic
- [ ] npm download counts and README summaries
- [ ] Scoring formula tuning

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
