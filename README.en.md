<div align="center">

# 🔍 findawheel

**An AI-era "find the wheel" assistant — discover existing wheels before you start coding.**

[![zh](https://img.shields.io/badge/lang-中文-blue.svg)](./README.md)
[![Build](https://img.shields.io/badge/build-passing-brightgreen.svg)](./)
[![Tests](https://img.shields.io/badge/tests-46%2F46-brightgreen.svg)](./)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

</div>

---

## 📖 Table of Contents

- [Introduction](#-introduction)
- [Why](#-why)
- [What It Does](#-what-it-does)
- [Quick Start](#-quick-start)
- [Connect to Your AI Client](#-connect-to-your-ai-client)
- [Environment Variables](#-environment-variables)
- [Architecture](#-architecture)
- [Development](#-development)
- [Data Sources (Phase 1)](#-data-sources-phase-1)
- [Roadmap](#-roadmap)
- [License](#-license)

---

## 🎯 Introduction

`findawheel` is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) service. Before you start implementing a new idea, it searches the web for existing reusable wheels — open-source projects, npm/crates packages, APIs, CLI tools, SDKs — so you don't have to reinvent them.

> 💡 **Use case**: When you tell your AI, "I want to build a Markdown-to-PDF tool," the AI first calls `findawheel` to find existing implementations and then recommends whether to reuse one.

---

## 🤔 Why

In the AI-coding era, everyone can quickly turn ideas into code. But many "new ideas" have already been built by someone else. The result: a lot of time wasted reinventing wheels.

`findawheel` adds one step before implementation:

```
Idea → Search existing wheels → Reuse or build yourself
```

---

## ✨ What It Does

Exposes a single MCP tool `find_wheel(query, intent?, ecosystem?, limit?)`:

- 🔎 **Multi-source search**: GitHub, npm, and crates.io
- 🧠 **Intent detection**: Automatically classifies queries as feature-level or project-level
- 📊 **Unified model**: Normalizes results from all sources into a single `Wheel` structure
- 🏆 **Quality ranking**: Ranks by stars, recency, activity, downloads, and license
- 🛡️ **Auto filtering**: Drops archived, stale, or low-information results
- ⚡ **Graceful degradation**: If one source fails, the others still return results

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

---

## 🤖 Connect to Your AI Client

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

Restart your client, describe your idea in conversation, and the AI will automatically call `find_wheel` to recommend reusable wheels.

---

## 🔧 Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_TOKEN` | no | — | GitHub Personal Access Token. Without it, GitHub API is limited to 60 req/h. |
| `FINDAWHEEL_LIMIT` | no | `10` | Default number of results returned. |
| `FINDAWHEEL_TIMEOUT_MS` | no | `8000` | Per-source request timeout in milliseconds. |
| `FINDAWHEEL_LOG_LEVEL` | no | `info` | Log level: `error` \| `warn` \| `info` \| `debug`. |

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
┌─────────────────────┐
│     Normalizer      │  ← normalizes to Wheel structure
│   MetricsEnricher   │  ← enriches activity metrics
│       Ranker        │  ← filter + score + dedupe
└─────────────────────┘
        │
        ▼
    Wheel[] returned to AI
```

---

## 🛠️ Development

```bash
npm run dev        # tsc --watch
npm test           # run all tests
npm run test:watch # run tests in watch mode
npm run build      # build to dist/
```

---

## 🌐 Data Sources (Phase 1)

| Source | Type | Notes |
|--------|------|-------|
| **GitHub** | Open-source repos | `/search/repositories`, sorted by stars |
| **npm** | JavaScript packages | registry search |
| **crates.io** | Rust packages | crates search |

> PyPI has no official search API, so Python packages are covered through GitHub mirrors in Phase 1. Phase 2 will add a generic web search source (Exa / Brave) for wheels not hosted on GitHub.

---

## 🗺️ Roadmap

- [x] Phase 1: GitHub + npm + crates.io search
- [x] Intent classification and quality ranking
- [ ] Phase 2: Web search source (Exa / Brave)
- [ ] Phase 2: Result caching and retry logic
- [ ] Phase 2: npm download counts and README summaries
- [ ] Phase 2: Scoring formula tuning

---

## 📄 License

[MIT](./LICENSE)

---

<div align="center">

**[中文版本](./README.md)**

</div>
