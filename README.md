# findawheel

An MCP (Model Context Protocol) service that searches for existing reusable wheels — open-source projects, packages, APIs, CLIs, SDKs — so AI coding assistants can avoid reinventing the wheel.

## Why

In the AI-coding era, many "new ideas" have already been built by someone else. `findawheel` adds one step before you start implementing: search the existing landscape, and reuse what's already out there.

## What it does

Exposes a single MCP tool `find_wheel(query, intent?, ecosystem?, limit?)` that searches GitHub + npm + crates.io, normalizes results into a unified `Wheel` structure, and returns them ranked by quality (stars, recency, activity, downloads, license).

Your AI assistant (Trae, Cursor, Claude Desktop, ...) calls this tool during your conversation and surfaces the best matches in plain language.

## Install

```bash
git clone <repo-url> findawheel
cd findawheel
npm install
npm run build
```

## Configure in your AI client

Add to your MCP client config (e.g. Trae / Cursor `mcp.json`):

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

Restart your client. Describe an idea in conversation — the AI will call `find_wheel` and recommend existing wheels.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_TOKEN` | no | — | GitHub PAT. Without it, GitHub API is limited to 60 req/h. |
| `FINDAWHEEL_LIMIT` | no | 10 | Default result limit. |
| `FINDAWHEEL_TIMEOUT_MS` | no | 8000 | Per-source request timeout. |
| `FINDAWHEEL_LOG_LEVEL` | no | info | error \| warn \| info \| debug |

## Development

```bash
npm run dev      # tsc --watch
npm test         # vitest run
npm run test:watch
```

## Data sources (Phase 1)

- **GitHub** — `/search/repositories`
- **npm** — registry search
- **crates.io** — crates search

PyPI has no official search API; Python packages are covered via GitHub mirrors. Phase 2 will add a generic web search source (Exa/Brave) for non-GitHub wheels.

## License

MIT
