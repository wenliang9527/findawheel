# findawheel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stdio MCP service that exposes a `find_wheel` tool, which searches GitHub + npm + crates.io for existing reusable wheels (projects, packages, APIs, CLIs, SDKs) so AI coding assistants can avoid reinventing the wheel.

**Architecture:** Adapter pattern — each data source is a `SourceAdapter` that returns `RawResult[]`, normalized into a unified `Wheel` structure by `Normalizer`, enriched by `MetricsEnricher`, then ranked/filtered by `Ranker`. The `findWheelTool` orchestrates these components and is registered on a stdio MCP server built with `@modelcontextprotocol/sdk`.

**Tech Stack:** TypeScript 5, Node 18+ (built-in fetch), `@modelcontextprotocol/sdk`, `zod`, `vitest`.

**Spec:** `docs/superpowers/specs/2026-07-02-findawheel-design.md`

---

## File Structure

Files to create, in dependency order (leaf utilities first, orchestration last):

| File | Responsibility |
|------|----------------|
| `package.json` | Dependencies + scripts |
| `tsconfig.json` | TS compiler config (NodeNext, strict) |
| `vitest.config.ts` | Vitest config |
| `.gitignore` | Ignore node_modules/dist/.env |
| `.env.example` | Documented env vars |
| `src/errors.ts` | Custom error classes (`RateLimitError`, `SourceError`) |
| `src/util/env.ts` | Typed env var reader with defaults |
| `src/util/http.ts` | fetch wrapper: timeout, UA, error normalization |
| `src/normalize/types.ts` | `Wheel`, `RawResult`, `FindWheelInput`, `FindWheelOutput` types |
| `src/classifier/queryClassifier.ts` | Heuristic intent classification |
| `src/sources/sourceAdapter.ts` | `SourceAdapter` interface |
| `src/sources/githubSourceAdapter.ts` | GitHub Search API adapter |
| `src/sources/registrySourceAdapter.ts` | npm + crates.io adapter |
| `src/normalize/normalizer.ts` | RawResult → Wheel |
| `src/enrich/metricsEnricher.ts` | Cross-source metric alignment + activity inference |
| `src/rank/ranker.ts` | Hard filter + weighted score + dedupe |
| `src/tools/findWheelTool.ts` | Orchestrates classifier→sources→normalize→enrich→rank |
| `src/server.ts` | MCP server setup, tool registration |
| `src/index.ts` | Entry point: start stdio transport |
| `README.md` | Install, config, IDE integration |
| Test files mirror `src/` under `tests/` |

---

## Task 1: Project Bootstrap

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "findawheel",
  "version": "0.1.0",
  "description": "MCP service that finds existing reusable wheels to avoid reinventing the wheel",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "start": "node dist/index.js"
  },
  "engines": { "node": ">=18" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.3.0",
    "vitest": "^1.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
.env
*.log
.DS_Store
```

- [ ] **Step 5: Create `.env.example`**

```
# Optional: GitHub Personal Access Token. Without it, GitHub API is limited to 60 req/hour.
GITHUB_TOKEN=

# Default limit of wheels returned per query. Default: 10
FINDAWHEEL_LIMIT=10

# Per-source request timeout in milliseconds. Default: 8000
FINDAWHEEL_TIMEOUT_MS=8000

# Log level: error | warn | info | debug. Default: info
FINDAWHEEL_LOG_LEVEL=info
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore .env.example
git commit -m "chore: bootstrap project with TS, vitest, MCP SDK"
```

---

## Task 2: Error Types

**Files:**
- Create: `src/errors.ts`
- Test: `tests/errors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/errors.test.ts
import { describe, it, expect } from 'vitest';
import { RateLimitError, SourceError } from '../src/errors.js';

describe('errors', () => {
  it('RateLimitError carries resetAt', () => {
    const reset = new Date('2026-01-01T00:00:00Z');
    const err = new RateLimitError('github', reset);
    expect(err).toBeInstanceOf(SourceError);
    expect(err.source).toBe('github');
    expect(err.resetAt).toBe(reset);
    expect(err.message).toContain('github');
  });

  it('SourceError carries source name', () => {
    const err = new SourceError('npm', 'network down');
    expect(err.source).toBe('npm');
    expect(err.message).toContain('npm');
    expect(err.message).toContain('network down');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/errors.test.ts`
Expected: FAIL — cannot find module `../src/errors.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/errors.ts
export class SourceError extends Error {
  constructor(public source: string, message: string) {
    super(`[${source}] ${message}`);
    this.name = 'SourceError';
  }
}

export class RateLimitError extends SourceError {
  constructor(source: string, public resetAt: Date) {
    super(source, `rate limited, resets at ${resetAt.toISOString()}`);
    this.name = 'RateLimitError';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/errors.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts tests/errors.test.ts
git commit -m "feat(errors): add SourceError and RateLimitError"
```

---

## Task 3: Env Config

**Files:**
- Create: `src/util/env.ts`
- Test: `tests/util/env.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/util/env.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { readEnv } from '../../src/util/env.js';

describe('readEnv', () => {
  beforeEach(() => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.FINDAWHEEL_LIMIT;
    delete process.env.FINDAWHEEL_TIMEOUT_MS;
    delete process.env.FINDAWHEEL_LOG_LEVEL;
  });

  it('returns defaults when env vars absent', () => {
    const env = readEnv();
    expect(env.githubToken).toBeUndefined();
    expect(env.limit).toBe(10);
    expect(env.timeoutMs).toBe(8000);
    expect(env.logLevel).toBe('info');
  });

  it('parses numeric env vars', () => {
    process.env.FINDAWHEEL_LIMIT = '5';
    process.env.FINDAWHEEL_TIMEOUT_MS = '3000';
    const env = readEnv();
    expect(env.limit).toBe(5);
    expect(env.timeoutMs).toBe(3000);
  });

  it('falls back to default on invalid number', () => {
    process.env.FINDAWHEEL_LIMIT = 'not-a-number';
    const env = readEnv();
    expect(env.limit).toBe(10);
  });

  it('reads github token', () => {
    process.env.GITHUB_TOKEN = 'ghp_xxx';
    expect(readEnv().githubToken).toBe('ghp_xxx');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/util/env.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/util/env.ts
export interface EnvConfig {
  githubToken?: string;
  limit: number;
  timeoutMs: number;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
}

function parseInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function readEnv(): EnvConfig {
  const level = process.env.FINDAWHEEL_LOG_LEVEL;
  const validLevels = ['error', 'warn', 'info', 'debug'] as const;
  return {
    githubToken: process.env.GITHUB_TOKEN || undefined,
    limit: parseInt(process.env.FINDAWHEEL_LIMIT, 10),
    timeoutMs: parseInt(process.env.FINDAWHEEL_TIMEOUT_MS, 8000),
    logLevel: level && (validLevels as readonly string[]).includes(level)
      ? (level as EnvConfig['logLevel'])
      : 'info',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/util/env.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/util/env.ts tests/util/env.test.ts
git commit -m "feat(env): typed env config reader with defaults"
```

---

## Task 4: HTTP Util

**Files:**
- Create: `src/util/http.ts`
- Test: `tests/util/http.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/util/http.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { httpGet, HttpError } from '../../src/util/http.js';

describe('httpGet', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed JSON on 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ hello: 'world' }),
    } as unknown as Response));
    const data = await httpGet('https://example.com', { timeoutMs: 1000 });
    expect(data).toEqual({ hello: 'world' });
  });

  it('throws HttpError on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers(),
      text: async () => 'forbidden',
    } as unknown as Response));
    await expect(httpGet('https://example.com', { timeoutMs: 1000 }))
      .rejects.toThrow(HttpError);
  });

  it('includes Authorization header when token provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({}),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    await httpGet('https://example.com', { timeoutMs: 1000, token: 'ghp_xxx' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ghp_xxx');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/util/http.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/util/http.ts
export class HttpError extends Error {
  constructor(public status: number, public url: string, body: string) {
    super(`HTTP ${status} from ${url}: ${body.slice(0, 200)}`);
    this.name = 'HttpError';
  }
}

export interface HttpGetOptions {
  timeoutMs: number;
  token?: string;
  userAgent?: string;
  extraHeaders?: Record<string, string>;
}

export async function httpGet<T>(url: string, opts: HttpGetOptions): Promise<T> {
  const headers: Record<string, string> = {
    'accept': 'application/json',
    'user-agent': opts.userAgent ?? 'findawheel/0.1',
    ...opts.extraHeaders,
  };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new HttpError(res.status, url, body);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/util/http.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/util/http.ts tests/util/http.test.ts
git commit -m "feat(http): fetch wrapper with timeout, auth, error normalization"
```

---

## Task 5: Core Types

**Files:**
- Create: `src/normalize/types.ts`

This task has no test (pure type definitions). Verify via `tsc --noEmit` in the next task that compiles code.

- [ ] **Step 1: Create the types file**

```ts
// src/normalize/types.ts
export type WheelSource = 'github' | 'npm' | 'pypi' | 'crates' | 'web';
export type WheelType = 'project' | 'package' | 'api' | 'cli' | 'sdk';
export type Activity = 'high' | 'medium' | 'low';

export interface WheelMetrics {
  stars?: number;
  lastUpdated?: string; // ISO date
  license?: string;
  archived?: boolean;
  downloads?: number;
  activity?: Activity;
}

export interface Wheel {
  name: string;
  source: WheelSource;
  url: string;
  description: string;
  type: WheelType;
  metrics: WheelMetrics;
}

export type Intent = 'feature' | 'project';

export interface FindWheelInput {
  query: string;
  intent?: 'feature' | 'project' | 'auto';
  ecosystem?: string;
  limit?: number;
}

export interface FindWheelOutput {
  query: string;
  intent: Intent;
  total: number;
  wheels: Wheel[];
  degradedSources?: string[];
}

// Discriminated union of raw results per source
export interface GitHubRawResult {
  source: 'github';
  name: string;
  url: string;
  description: string;
  stars: number;
  language: string | null;
  license: string | null;
  archived: boolean;
  pushedAt: string;
  topics: string[];
}

export interface NpmRawResult {
  source: 'npm';
  name: string;
  url: string;
  description: string;
  version: string;
  keywords: string[];
  date: string; // last publish
}

export interface CratesRawResult {
  source: 'crates';
  name: string;
  url: string;
  description: string;
  version: string;
  downloads: number;
  recentDownloads: number;
  updatedAt: string;
  license: string | null;
}

export type RawResult = GitHubRawResult | NpmRawResult | CratesRawResult;
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/normalize/types.ts
git commit -m "feat(types): add Wheel, RawResult, FindWheelInput/Output types"
```

---

## Task 6: QueryClassifier

**Files:**
- Create: `src/classifier/queryClassifier.ts`
- Test: `tests/classifier/queryClassifier.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/classifier/queryClassifier.test.ts
import { describe, it, expect } from 'vitest';
import { classify } from '../../src/classifier/queryClassifier.js';

describe('classify', () => {
  it('returns explicit hint when not auto', () => {
    expect(classify('whatever', 'feature')).toBe('feature');
    expect(classify('whatever', 'project')).toBe('project');
  });

  it('detects feature signals', () => {
    expect(classify('parse markdown to pdf')).toBe('feature');
    expect(classify('compress images in bulk')).toBe('feature');
  });

  it('detects project signals', () => {
    expect(classify('build a notion-like notes app')).toBe('project');
    expect(classify('markdown editor with dashboard')).toBe('project');
  });

  it('defaults to project when tied or unknown', () => {
    expect(classify('random unknown phrase')).toBe('project');
    expect(classify('app parse')).toBe('project'); // 1-1 tie
  });

  it('handles chinese signal words', () => {
    expect(classify('解析 markdown')).toBe('feature');
    expect(classify('做一个笔记应用')).toBe('project');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/classifier/queryClassifier.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/classifier/queryClassifier.ts
import type { Intent } from '../normalize/types.js';

const PROJECT_SIGNALS = [
  'app', 'application', 'platform', 'tool', 'editor', 'dashboard',
  '系统', '平台', '应用', '编辑器', '网站', '管理系统',
];

const FEATURE_SIGNALS = [
  'parse', 'convert', 'generate', 'compress', 'encrypt',
  'client', 'sdk', 'wrapper',
  '解析', '转换', '压缩', '加密', '客户端',
];

export function classify(
  query: string,
  hint?: 'feature' | 'project' | 'auto',
): Intent {
  if (hint && hint !== 'auto') return hint;
  const lower = query.toLowerCase();
  const projectScore = PROJECT_SIGNALS.filter(w => lower.includes(w)).length;
  const featureScore = FEATURE_SIGNALS.filter(w => lower.includes(w)).length;
  if (featureScore > projectScore) return 'feature';
  return 'project'; // ties and unknowns default to project
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/classifier/queryClassifier.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/classifier/queryClassifier.ts tests/classifier/queryClassifier.test.ts
git commit -m "feat(classifier): heuristic intent classifier"
```

---

## Task 7: SourceAdapter Interface

**Files:**
- Create: `src/sources/sourceAdapter.ts`

No test (pure interface). Verified via compile in next tasks.

- [ ] **Step 1: Create the interface**

```ts
// src/sources/sourceAdapter.ts
import type { RawResult } from '../normalize/types.js';

export interface SourceAdapter {
  readonly name: string;
  search(query: string, opts: SearchOpts): Promise<RawResult[]>;
}

export interface SearchOpts {
  intent: 'feature' | 'project';
  ecosystem?: string;
  timeoutMs: number;
  githubToken?: string;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/sources/sourceAdapter.ts
git commit -m "feat(sources): define SourceAdapter interface"
```

---

## Task 8: GitHubSourceAdapter

**Files:**
- Create: `src/sources/githubSourceAdapter.ts`
- Test: `tests/sources/githubSourceAdapter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/sources/githubSourceAdapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubSourceAdapter, buildGithubQuery } from '../../src/sources/githubSourceAdapter.js';

describe('buildGithubQuery', () => {
  it('project intent searches name+description', () => {
    const q = buildGithubQuery('markdown editor', 'project', undefined);
    expect(q).toContain('markdown editor in:name,description');
    expect(q).toContain('sort:stars');
  });

  it('feature intent includes readme', () => {
    const q = buildGithubQuery('parse pdf', 'feature', undefined);
    expect(q).toContain('in:name,description,readme');
  });

  it('adds language filter when ecosystem provided', () => {
    const q = buildGithubQuery('markdown editor', 'project', 'js');
    expect(q).toContain('language:JavaScript');
  });
});

describe('GitHubSourceAdapter.search', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('parses GitHub response into RawResult[]', async () => {
    const fakeResponse = {
      total_count: 1,
      items: [{
        full_name: 'owner/repo',
        html_url: 'https://github.com/owner/repo',
        description: 'A markdown editor',
        stargazers_count: 100,
        language: 'TypeScript',
        license: { spdx_id: 'MIT' },
        archived: false,
        pushed_at: '2025-01-01T00:00:00Z',
        topics: ['editor'],
      }],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fakeResponse,
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new GitHubSourceAdapter();
    const results = await adapter.search('markdown editor', {
      intent: 'project', timeoutMs: 1000,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      source: 'github',
      name: 'owner/repo',
      url: 'https://github.com/owner/repo',
      description: 'A markdown editor',
      stars: 100,
      language: 'TypeScript',
      license: 'MIT',
      archived: false,
      pushedAt: '2025-01-01T00:00:00Z',
      topics: ['editor'],
    });
    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.pathname).toBe('/search/repositories');
  });

  it('throws RateLimitError on 403 with rate-limit header', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1735689600' }),
      text: async () => 'rate limited',
    } as unknown as Response));
    const adapter = new GitHubSourceAdapter();
    await expect(adapter.search('x', { intent: 'project', timeoutMs: 1000 }))
      .rejects.toThrow(/rate limited/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sources/githubSourceAdapter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/sources/githubSourceAdapter.ts
import type { SourceAdapter, SearchOpts } from './sourceAdapter.js';
import type { GitHubRawResult, RawResult } from '../normalize/types.js';
import { httpGet, HttpError } from '../util/http.js';
import { RateLimitError, SourceError } from '../errors.js';

const ECOSYSTEM_LANG: Record<string, string> = {
  js: 'JavaScript', ts: 'TypeScript',
  python: 'Python', rust: 'Rust', go: 'Go', java: 'Java',
};

export function buildGithubQuery(
  query: string,
  intent: 'feature' | 'project',
  ecosystem?: string,
): string {
  const inClause = intent === 'feature'
    ? 'in:name,description,readme'
    : 'in:name,description';
  const parts = [`${query} ${inClause}`, 'sort:stars'];
  if (ecosystem && ECOSYSTEM_LANG[ecosystem]) {
    parts.push(`language:${ECOSYSTEM_LANG[ecosystem]}`);
  }
  return parts.join(' ');
}

interface GitHubSearchResponse {
  total_count: number;
  items: Array<{
    full_name: string;
    html_url: string;
    description: string | null;
    stargazers_count: number;
    language: string | null;
    license: { spdx_id: string | null } | null;
    archived: boolean;
    pushed_at: string;
    topics?: string[];
  }>;
}

export class GitHubSourceAdapter implements SourceAdapter {
  readonly name = 'github';

  async search(query: string, opts: SearchOpts): Promise<RawResult[]> {
    const q = buildGithubQuery(query, opts.intent, opts.ecosystem);
    const url = new URL('https://api.github.com/search/repositories');
    url.searchParams.set('q', q);
    url.searchParams.set('sort', 'stars');
    url.searchParams.set('order', 'desc');
    url.searchParams.set('per_page', '20');

    try {
      const data = await httpGet<GitHubSearchResponse>(url.toString(), {
        timeoutMs: opts.timeoutMs,
        token: opts.githubToken,
        extraHeaders: { 'accept': 'application/vnd.github+json' },
      });
      return data.items.map((item): GitHubRawResult => ({
        source: 'github',
        name: item.full_name,
        url: item.html_url,
        description: item.description ?? '',
        stars: item.stargazers_count,
        language: item.language,
        license: item.license?.spdx_id ?? null,
        archived: item.archived,
        pushedAt: item.pushed_at,
        topics: item.topics ?? [],
      }));
    } catch (err) {
      if (err instanceof HttpError && err.status === 403) throw new RateLimitError('github', new Date());
      if (err instanceof HttpError) throw new SourceError('github', `HTTP ${err.status}`);
      throw new SourceError('github', (err as Error).message);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sources/githubSourceAdapter.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sources/githubSourceAdapter.ts tests/sources/githubSourceAdapter.test.ts
git commit -m "feat(sources): GitHub Search API adapter"
```

---

## Task 9: RegistrySourceAdapter (npm + crates.io)

**Files:**
- Create: `src/sources/registrySourceAdapter.ts`
- Test: `tests/sources/registrySourceAdapter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/sources/registrySourceAdapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RegistrySourceAdapter } from '../../src/sources/registrySourceAdapter.js';

describe('RegistrySourceAdapter.search', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('queries npm when ecosystem is js', async () => {
    const npmResp = {
      objects: [{
        package: {
          name: 'lodash',
          version: '4.17.21',
          description: 'Utility library',
          links: { npm: 'https://www.npmjs.com/package/lodash' },
          keywords: ['utils'],
          date: '2024-01-01T00:00:00Z',
        },
      }],
      total: 1,
    };
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('https://registry.npmjs.org')) {
        return Promise.resolve({
          ok: true, status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => npmResp,
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ crates: [] }),
      } as unknown as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new RegistrySourceAdapter();
    const results = await adapter.search('utility library', {
      intent: 'feature', ecosystem: 'js', timeoutMs: 1000,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      source: 'npm',
      name: 'lodash',
      description: 'Utility library',
    });
  });

  it('queries crates.io when ecosystem is rust', async () => {
    const cratesResp = {
      crates: [{
        id: 'serde',
        name: 'serde',
        description: 'Serialization framework',
        max_version: '1.0.0',
        downloads: 1000000,
        recent_downloads: 50000,
        updated_at: '2025-01-01T00:00:00Z',
        repository: 'https://github.com/serde-rs/serde',
      }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => cratesResp,
    } as unknown as Response));

    const adapter = new RegistrySourceAdapter();
    const results = await adapter.search('serialization', {
      intent: 'feature', ecosystem: 'rust', timeoutMs: 1000,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      source: 'crates', name: 'serde', downloads: 1000000,
    });
  });

  it('skips PyPI (returns empty for python)', async () => {
    const adapter = new RegistrySourceAdapter();
    const results = await adapter.search('something', {
      intent: 'feature', ecosystem: 'python', timeoutMs: 1000,
    });
    expect(results).toEqual([]);
  });

  it('queries both npm and crates when no ecosystem specified', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const resp = url.startsWith('https://registry.npmjs.org')
        ? { objects: [], total: 0 }
        : { crates: [] };
      return Promise.resolve({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => resp,
      } as unknown as Response);
    });
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new RegistrySourceAdapter();
    await adapter.search('lib', { intent: 'feature', timeoutMs: 1000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sources/registrySourceAdapter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/sources/registrySourceAdapter.ts
import type { SourceAdapter, SearchOpts } from './sourceAdapter.js';
import type { NpmRawResult, CratesRawResult, RawResult } from '../normalize/types.js';
import { httpGet, HttpError } from '../util/http.js';
import { SourceError } from '../errors.js';

interface NpmSearchResponse {
  objects: Array<{
    package: {
      name: string;
      version: string;
      description: string | null;
      links: { npm?: string; repository?: string; homepage?: string };
      keywords?: string[];
      date: string;
    };
  }>;
  total: number;
}

interface CratesSearchResponse {
  crates: Array<{
    id: string;
    name: string;
    description: string | null;
    max_version: string;
    downloads: number;
    recent_downloads: number;
    updated_at: string;
    repository: string | null;
  }>;
}

async function searchNpm(query: string, timeoutMs: number): Promise<NpmRawResult[]> {
  const url = new URL('https://registry.npmjs.org/-/v1/search');
  url.searchParams.set('text', query);
  url.searchParams.set('size', '20');
  try {
    const data = await httpGet<NpmSearchResponse>(url.toString(), { timeoutMs });
    return data.objects.map(o => ({
      source: 'npm' as const,
      name: o.package.name,
      url: o.package.links.npm ?? `https://www.npmjs.com/package/${o.package.name}`,
      description: o.package.description ?? '',
      version: o.package.version,
      keywords: o.package.keywords ?? [],
      date: o.package.date,
    }));
  } catch (err) {
    if (err instanceof HttpError) throw new SourceError('npm', `HTTP ${err.status}`);
    throw new SourceError('npm', (err as Error).message);
  }
}

async function searchCrates(query: string, timeoutMs: number): Promise<CratesRawResult[]> {
  const url = new URL('https://crates.io/api/v1/crates');
  url.searchParams.set('q', query);
  url.searchParams.set('per_page', '20');
  try {
    const data = await httpGet<CratesSearchResponse>(url.toString(), {
      timeoutMs,
      userAgent: 'findawheel/0.1 (https://github.com/findawheel)',
    });
    return data.crates.map(c => ({
      source: 'crates' as const,
      name: c.name,
      url: `https://crates.io/crates/${c.name}`,
      description: c.description ?? '',
      version: c.max_version,
      downloads: c.downloads,
      recentDownloads: c.recent_downloads,
      updatedAt: c.updated_at,
      license: null, // crates search endpoint doesn't return license
    }));
  } catch (err) {
    if (err instanceof HttpError) throw new SourceError('crates', `HTTP ${err.status}`);
    throw new SourceError('crates', (err as Error).message);
  }
}

export class RegistrySourceAdapter implements SourceAdapter {
  readonly name = 'registry';

  async search(query: string, opts: SearchOpts): Promise<RawResult[]> {
    const eco = opts.ecosystem;
    // PyPI has no search API — skip, GitHub adapter covers Python via mirror repos
    if (eco === 'python') return [];
    const tasks: Promise<RawResult[]>[] = [];
    if (!eco || eco === 'js' || eco === 'ts') {
      tasks.push(searchNpm(query, opts.timeoutMs).then(r => r as RawResult[]));
    }
    if (!eco || eco === 'rust') {
      tasks.push(searchCrates(query, opts.timeoutMs).then(r => r as RawResult[]));
    }
    const settled = await Promise.allSettled(tasks);
    const ok: RawResult[] = [];
    const errors: SourceError[] = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') ok.push(...r.value);
      else if (r.value instanceof SourceError) errors.push(r.value);
      else errors.push(new SourceError('registry', String(r.reason)));
    }
    // Re-throw only if ALL sub-sources failed AND there were tasks
    if (ok.length === 0 && errors.length > 0 && tasks.length === errors.length) {
      throw errors[0];
    }
    return ok;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sources/registrySourceAdapter.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sources/registrySourceAdapter.ts tests/sources/registrySourceAdapter.test.ts
git commit -m "feat(sources): npm + crates.io registry adapter"
```

---

## Task 10: Normalizer

**Files:**
- Create: `src/normalize/normalizer.ts`
- Test: `tests/normalize/normalizer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/normalize/normalizer.test.ts
import { describe, it, expect } from 'vitest';
import { normalize } from '../../src/normalize/normalizer.js';
import type { RawResult } from '../../src/normalize/types.js';

describe('normalize', () => {
  it('maps GitHub result with cli topic to cli type', () => {
    const raw: RawResult = {
      source: 'github',
      name: 'foo/cli',
      url: 'https://github.com/foo/cli',
      description: 'A CLI tool',
      stars: 50,
      language: 'Go',
      license: 'MIT',
      archived: false,
      pushedAt: '2025-06-01T00:00:00Z',
      topics: ['cli', 'tool'],
    };
    const wheel = normalize(raw);
    expect(wheel.type).toBe('cli');
    expect(wheel.metrics.stars).toBe(50);
    expect(wheel.metrics.license).toBe('MIT');
    expect(wheel.metrics.archived).toBe(false);
    expect(wheel.metrics.lastUpdated).toBe('2025-06-01T00:00:00Z');
  });

  it('maps GitHub result without special topics to project type', () => {
    const raw: RawResult = {
      source: 'github', name: 'foo/app', url: 'https://github.com/foo/app',
      description: 'd', stars: 0, language: null, license: null,
      archived: false, pushedAt: '2025-01-01T00:00:00Z', topics: [],
    };
    expect(normalize(raw).type).toBe('project');
  });

  it('maps npm result as package type', () => {
    const raw: RawResult = {
      source: 'npm', name: 'lodash', url: 'https://www.npmjs.com/package/lodash',
      description: 'utils', version: '4.17.21', keywords: ['utils'],
      date: '2024-01-01T00:00:00Z',
    };
    const w = normalize(raw);
    expect(w.type).toBe('package');
    expect(w.metrics.lastUpdated).toBe('2024-01-01T00:00:00Z');
    expect(w.metrics.stars).toBeUndefined();
  });

  it('maps crates result with downloads', () => {
    const raw: RawResult = {
      source: 'crates', name: 'serde', url: 'https://crates.io/crates/serde',
      description: 'ser', version: '1.0', downloads: 1000, recentDownloads: 100,
      updatedAt: '2025-05-01T00:00:00Z', license: 'MIT',
    };
    const w = normalize(raw);
    expect(w.type).toBe('package');
    expect(w.metrics.downloads).toBe(1000);
    expect(w.metrics.license).toBe('MIT');
  });

  it('handles archived github repo', () => {
    const raw: RawResult = {
      source: 'github', name: 'foo/old', url: '', description: '',
      stars: 0, language: null, license: null, archived: true,
      pushedAt: '2020-01-01T00:00:00Z', topics: [],
    };
    expect(normalize(raw).metrics.archived).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/normalize/normalizer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/normalize/normalizer.ts
import type { RawResult, Wheel, WheelType } from './types.js';

function inferTypeFromTopics(topics: string[]): WheelType | null {
  const t = topics.map(s => s.toLowerCase());
  if (t.includes('cli')) return 'cli';
  if (t.includes('sdk')) return 'sdk';
  if (t.includes('api')) return 'api';
  return null;
}

export function normalize(raw: RawResult): Wheel {
  switch (raw.source) {
    case 'github': {
      const type = inferTypeFromTopics(raw.topics) ?? 'project';
      return {
        name: raw.name,
        source: 'github',
        url: raw.url,
        description: raw.description,
        type,
        metrics: {
          stars: raw.stars,
          lastUpdated: raw.pushedAt,
          license: raw.license ?? undefined,
          archived: raw.archived,
        },
      };
    }
    case 'npm':
      return {
        name: raw.name,
        source: 'npm',
        url: raw.url,
        description: raw.description,
        type: 'package',
        metrics: { lastUpdated: raw.date },
      };
    case 'crates':
      return {
        name: raw.name,
        source: 'crates',
        url: raw.url,
        description: raw.description,
        type: 'package',
        metrics: {
          lastUpdated: raw.updatedAt,
          downloads: raw.downloads,
          license: raw.license ?? undefined,
        },
      };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/normalize/normalizer.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/normalize/normalizer.ts tests/normalize/normalizer.test.ts
git commit -m "feat(normalize): RawResult to Wheel normalizer"
```

---

## Task 11: MetricsEnricher

**Files:**
- Create: `src/enrich/metricsEnricher.ts`
- Test: `tests/enrich/metricsEnricher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/enrich/metricsEnricher.test.ts
import { describe, it, expect } from 'vitest';
import { enrich, inferActivity } from '../../src/enrich/metricsEnricher.js';

describe('inferActivity', () => {
  it('returns high when updated within 6 months', () => {
    const recent = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    expect(inferActivity(recent)).toBe('high');
  });
  it('returns medium when within 2 years', () => {
    const d = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
    expect(inferActivity(d)).toBe('medium');
  });
  it('returns low when older or undefined', () => {
    const old = new Date('2020-01-01T00:00:00Z').toISOString();
    expect(inferActivity(old)).toBe('low');
    expect(inferActivity(undefined)).toBe('low');
  });
});

describe('enrich', () => {
  it('sets activity based on lastUpdated', () => {
    const recent = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const w = enrich({
      name: 'x', source: 'github', url: '', description: '', type: 'project',
      metrics: { lastUpdated: recent },
    });
    expect(w.metrics.activity).toBe('high');
  });
  it('does not overwrite existing fields', () => {
    const w = enrich({
      name: 'x', source: 'npm', url: '', description: '', type: 'package',
      metrics: { stars: 10 },
    });
    expect(w.metrics.stars).toBe(10);
    expect(w.metrics.activity).toBe('low'); // no lastUpdated
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/enrich/metricsEnricher.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/enrich/metricsEnricher.ts
import type { Wheel, Activity } from '../normalize/types.js';

const SIX_MONTHS_MS = 180 * 24 * 3600 * 1000;
const TWO_YEARS_MS = 730 * 24 * 3600 * 1000;

export function inferActivity(lastUpdated?: string): Activity {
  if (!lastUpdated) return 'low';
  const then = Date.parse(lastUpdated);
  if (Number.isNaN(then)) return 'low';
  const age = Date.now() - then;
  if (age <= SIX_MONTHS_MS) return 'high';
  if (age <= TWO_YEARS_MS) return 'medium';
  return 'low';
}

export function enrich(wheel: Wheel): Wheel {
  return {
    ...wheel,
    metrics: {
      ...wheel.metrics,
      activity: inferActivity(wheel.metrics.lastUpdated),
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/enrich/metricsEnricher.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/enrich/metricsEnricher.ts tests/enrich/metricsEnricher.test.ts
git commit -m "feat(enrich): metrics enrichment with activity inference"
```

---

## Task 12: Ranker

**Files:**
- Create: `src/rank/ranker.ts`
- Test: `tests/rank/ranker.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/rank/ranker.test.ts
import { describe, it, expect } from 'vitest';
import { rank, filterOut, score, dedupe } from '../../src/rank/ranker.js';
import type { Wheel } from '../../src/normalize/types.js';

function makeWheel(over: Partial<Wheel> = {}): Wheel {
  return {
    name: 'x', source: 'github', url: 'https://github.com/x/x',
    description: 'desc', type: 'project',
    metrics: { stars: 100, lastUpdated: '2025-01-01T00:00:00Z', license: 'MIT', archived: false },
    ...over,
  };
}

describe('filterOut', () => {
  it('removes archived', () => {
    const w = makeWheel({ metrics: { archived: true } });
    expect(filterOut(w)).toBe(true);
  });
  it('removes lastUpdated older than 3 years', () => {
    const w = makeWheel({ metrics: { lastUpdated: '2020-01-01T00:00:00Z' } });
    expect(filterOut(w)).toBe(true);
  });
  it('removes empty description with stars < 10', () => {
    const w = makeWheel({ description: '', metrics: { stars: 5 } });
    expect(filterOut(w)).toBe(true);
  });
  it('keeps active repo with description', () => {
    expect(filterOut(makeWheel())).toBe(false);
  });
});

describe('score', () => {
  it('higher stars scores higher', () => {
    const low = score(makeWheel({ metrics: { stars: 10 } }), 'project');
    const high = score(makeWheel({ metrics: { stars: 30000 } }), 'project');
    expect(high).toBeGreaterThan(low);
  });
  it('feature intent boosts downloads weight', () => {
    const w = makeWheel({ source: 'crates', type: 'package', metrics: { downloads: 80000 } });
    const f = score(w, 'feature');
    const p = score(w, 'project');
    expect(f).toBeGreaterThan(p);
  });
});

describe('dedupe', () => {
  it('merges same name keeping richer metrics', () => {
    const a = makeWheel({ name: 'lodash', source: 'npm', metrics: { lastUpdated: '2025-01-01T00:00:00Z' } });
    const b = makeWheel({ name: 'lodash', source: 'github', metrics: { stars: 50000, lastUpdated: '2025-01-01T00:00:00Z' } });
    const out = dedupe([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].metrics.stars).toBe(50000);
  });
});

describe('rank', () => {
  it('filters then sorts by score desc and applies limit', () => {
    const bad = makeWheel({ name: 'bad', metrics: { archived: true } });
    const good = makeWheel({ name: 'good', metrics: { stars: 40000 } });
    const mid = makeWheel({ name: 'mid', metrics: { stars: 100 } });
    const out = rank([bad, mid, good], 'project', 10);
    expect(out.map(w => w.name)).toEqual(['good', 'mid']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/rank/ranker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/rank/ranker.ts
import type { Wheel, Intent, WheelMetrics } from '../normalize/types.js';

const THREE_YEARS_MS = 3 * 365 * 24 * 3600 * 1000;
const NOW = Date.now();

export function filterOut(wheel: Wheel): boolean {
  const m = wheel.metrics;
  if (m.archived === true) return true;
  if (m.lastUpdated) {
    const t = Date.parse(m.lastUpdated);
    if (!Number.isNaN(t) && NOW - t > THREE_YEARS_MS) return true;
  }
  if ((!wheel.description || wheel.description.trim() === '') && (m.stars ?? 0) < 10) return true;
  return false;
}

function normalize(v: number | undefined, max: number): number {
  if (v === undefined || v <= 0) return 0;
  return Math.min(v / max, 1);
}

function recencyScore(lastUpdated?: string): number {
  if (!lastUpdated) return 0;
  const t = Date.parse(lastUpdated);
  if (Number.isNaN(t)) return 0;
  const ageMs = NOW - t;
  const oneYear = 365 * 24 * 3600 * 1000;
  if (ageMs <= oneYear) return 1.0;
  if (ageMs <= 2 * oneYear) return 0.7;
  if (ageMs <= 3 * oneYear) return 0.4;
  return 0;
}

function activityScore(activity?: WheelMetrics['activity']): number {
  switch (activity) {
    case 'high': return 1.0;
    case 'medium': return 0.5;
    case 'low': return 0.2;
    default: return 0;
  }
}

export function score(wheel: Wheel, intent: Intent): number {
  const m = wheel.metrics;
  let stars = normalize(m.stars, 50000) * 0.3;
  const recency = recencyScore(m.lastUpdated) * 0.3;
  const activity = activityScore(m.activity) * 0.2;
  let downloads = normalize(m.downloads, 100000) * 0.1;
  const license = m.license ? 0.1 : 0;
  if (intent === 'feature') {
    stars *= 0.7;
    downloads *= 1.5;
  }
  return stars + recency + activity + downloads + license;
}

export function dedupe(wheels: Wheel[]): Wheel[] {
  const map = new Map<string, Wheel>();
  for (const w of wheels) {
    const key = w.name.toLowerCase();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, w);
      continue;
    }
    // Merge: keep richer metrics (more defined fields)
    const wScore = Object.values(w.metrics).filter(v => v !== undefined).length;
    const eScore = Object.values(existing.metrics).filter(v => v !== undefined).length;
    if (wScore > eScore) map.set(key, w);
  }
  return [...map.values()];
}

export function rank(wheels: Wheel[], intent: Intent, limit: number): Wheel[] {
  const filtered = wheels.filter(w => !filterOut(w));
  const deduped = dedupe(filtered);
  const scored = deduped
    .map(w => ({ w, s: score(w, intent) }))
    .sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map(x => x.w);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/rank/ranker.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/rank/ranker.ts tests/rank/ranker.test.ts
git commit -m "feat(rank): filter, score, dedupe, and rank wheels"
```

---

## Task 13: findWheelTool (Orchestration)

**Files:**
- Create: `src/tools/findWheelTool.ts`
- Test: `tests/tools/findWheelTool.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/findWheelTool.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFindWheelTool } from '../../src/tools/findWheelTool.js';
import type { SourceAdapter, SearchOpts } from '../../src/sources/sourceAdapter.js';
import type { RawResult } from '../../src/normalize/types.js';
import { SourceError } from '../../src/errors.js';

function mockAdapter(name: string, results: RawResult[]): SourceAdapter {
  return {
    name,
    async search(_q: string, _o: SearchOpts): Promise<RawResult[]> { return results; },
  };
}

function failingAdapter(name: string): SourceAdapter {
  return {
    name,
    async search(): Promise<RawResult[]> { throw new SourceError(name, 'down'); },
  };
}

describe('findWheelTool.handle', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns empty query error', async () => {
    const tool = createFindWheelTool({ adapters: [] });
    const res = await tool.handle({ query: '' });
    expect(res.isError).toBe(true);
  });

  it('aggregates results from multiple adapters', async () => {
    const gh: RawResult = {
      source: 'github', name: 'a/b', url: 'https://github.com/a/b', description: 'd',
      stars: 100, language: null, license: 'MIT', archived: false,
      pushedAt: '2025-06-01T00:00:00Z', topics: [],
    };
    const npm: RawResult = {
      source: 'npm', name: 'pkg', url: 'https://www.npmjs.com/package/pkg',
      description: 'd', version: '1.0', keywords: [], date: '2025-06-01T00:00:00Z',
    };
    const tool = createFindWheelTool({
      adapters: [mockAdapter('github', [gh]), mockAdapter('npm', [npm])],
    });
    const res = await tool.handle({ query: 'markdown editor' });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);
    expect(payload.wheels).toHaveLength(2);
    expect(payload.intent).toBe('project');
  });

  it('records degraded sources when one fails', async () => {
    const gh: RawResult = {
      source: 'github', name: 'a/b', url: 'https://github.com/a/b', description: 'd',
      stars: 100, language: null, license: 'MIT', archived: false,
      pushedAt: '2025-06-01T00:00:00Z', topics: [],
    };
    const tool = createFindWheelTool({
      adapters: [mockAdapter('github', [gh]), failingAdapter('npm')],
    });
    const res = await tool.handle({ query: 'x' });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);
    expect(payload.wheels).toHaveLength(1);
    expect(payload.degradedSources).toEqual(['npm']);
  });

  it('returns isError when all adapters fail', async () => {
    const tool = createFindWheelTool({
      adapters: [failingAdapter('github'), failingAdapter('npm')],
    });
    const res = await tool.handle({ query: 'x' });
    expect(res.isError).toBe(true);
  });

  it('returns empty wheels when all sources return 0', async () => {
    const tool = createFindWheelTool({
      adapters: [mockAdapter('github', [])],
    });
    const res = await tool.handle({ query: 'x' });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);
    expect(payload.wheels).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/findWheelTool.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tools/findWheelTool.ts
import type { SourceAdapter } from '../sources/sourceAdapter.js';
import type {
  FindWheelInput, FindWheelOutput, Intent, RawResult, Wheel,
} from '../normalize/types.js';
import { classify } from '../classifier/queryClassifier.js';
import { normalize } from '../normalize/normalizer.js';
import { enrich } from '../enrich/metricsEnricher.js';
import { rank } from '../rank/ranker.js';
import { readEnv } from '../util/env.js';
import { SourceError } from '../errors.js';

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface CreateToolOpts {
  adapters: SourceAdapter[];
}

export function createFindWheelTool(opts: CreateToolOpts) {
  const env = readEnv();

  async function handle(input: FindWheelInput): Promise<McpToolResult> {
    if (!input.query || input.query.trim() === '') {
      return {
        content: [{ type: 'text', text: 'query is required' }],
        isError: true,
      };
    }
    const intent: Intent = classify(input.query, input.intent);
    const limit = input.limit ?? env.limit;
    const timeoutMs = env.timeoutMs;

    const searchOpts = {
      intent, ecosystem: input.ecosystem, timeoutMs, githubToken: env.githubToken,
    };

    const settled = await Promise.allSettled(
      opts.adapters.map(a => a.search(input.query, searchOpts)),
    );

    const allRaw: RawResult[] = [];
    const degraded: string[] = [];
    let allFailed = true;
    for (let i = 0; i < settled.length; i++) {
      const r = settled[i];
      const name = opts.adapters[i].name;
      if (r.status === 'fulfilled') {
        allRaw.push(...r.value);
        if (r.value.length > 0) allFailed = false;
      } else {
        degraded.push(name);
        // allFailed stays true unless another source returned data
      }
    }
    // If any source succeeded (even with 0 results), it's not all-failed
    if (settled.some(r => r.status === 'fulfilled')) allFailed = false;

    if (allFailed) {
      return {
        content: [{ type: 'text', text: 'all data sources unavailable' }],
        isError: true,
      };
    }

    const wheels: Wheel[] = allRaw.map(normalize).map(enrich);
    const ranked = rank(wheels, intent, limit);
    const output: FindWheelOutput = {
      query: input.query,
      intent,
      total: allRaw.length,
      wheels: ranked,
      ...(degraded.length > 0 ? { degradedSources: degraded } : {}),
    };
    return { content: [{ type: 'text', text: JSON.stringify(output) }] };
  }

  return { handle };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools/findWheelTool.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/findWheelTool.ts tests/tools/findWheelTool.test.ts
git commit -m "feat(tool): findWheelTool orchestration with degradation"
```

---

## Task 14: MCP Server + Entry Point

**Files:**
- Create: `src/server.ts`
- Create: `src/index.ts`
- Test: manual smoke test

No unit test — MCP server wiring is best validated by a manual smoke test. Verify by `tsc --noEmit` that it compiles.

- [ ] **Step 1: Create `src/server.ts`**

```ts
// src/server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createFindWheelTool } from './tools/findWheelTool.js';
import { GitHubSourceAdapter } from './sources/githubSourceAdapter.js';
import { RegistrySourceAdapter } from './sources/registrySourceAdapter.js';

const InputSchema = z.object({
  query: z.string(),
  intent: z.enum(['feature', 'project', 'auto']).optional(),
  ecosystem: z.string().optional(),
  limit: z.number().int().positive().optional(),
});

export function createServer() {
  const tool = createFindWheelTool({
    adapters: [new GitHubSourceAdapter(), new RegistrySourceAdapter()],
  });

  const server = new Server(
    { name: 'findawheel', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{
      name: 'find_wheel',
      description:
        'Search for existing reusable wheels (open-source projects, packages, APIs, CLIs, SDKs) for a feature or project idea. Call this BEFORE implementing a new idea to avoid reinventing the wheel.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Feature or project idea in natural language' },
          intent: { type: 'string', enum: ['feature', 'project', 'auto'], default: 'auto' },
          ecosystem: { type: 'string', description: 'js | ts | python | rust | go | java' },
          limit: { type: 'number', minimum: 1, default: 10 },
        },
        required: ['query'],
      },
    }],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name !== 'find_wheel') {
      return { content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }], isError: true };
    }
    const parsed = InputSchema.safeParse(req.params.arguments);
    if (!parsed.success) {
      return { content: [{ type: 'text', text: parsed.error.message }], isError: true };
    }
    return tool.handle(parsed.data);
  });

  return server;
}

export async function runServer() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

- [ ] **Step 2: Create `src/index.ts`**

```ts
// src/index.ts
import { runServer } from './server.js';

runServer().catch(err => {
  console.error('[findawheel] fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: `dist/` created with compiled JS.

- [ ] **Step 5: Manual smoke test**

Run (in a separate terminal, piping an MCP initialize request):
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.0.0"}}}' | node dist/index.js
```
Expected: a JSON-RPC response with serverInfo containing `findawheel`.

- [ ] **Step 6: Commit**

```bash
git add src/server.ts src/index.ts
git commit -m "feat(server): MCP server with find_wheel tool registration"
```

---

## Task 15: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

````markdown
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
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with install and config instructions"
```

---

## Task 16: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: `dist/` populated, no errors.

- [ ] **Step 3: Manual end-to-end smoke test**

Run with a real `find_wheel` call over stdio:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"find_wheel","arguments":{"query":"markdown to pdf","intent":"feature","limit":3}}}' | node dist/index.js
```
Expected: a JSON-RPC response whose `result.content[0].text` parses to an object with `wheels` array containing real GitHub/npm results.

- [ ] **Step 4: Verify success criteria from spec**

Manually verify against spec section 9:
1. Tool is callable and returns structured results — ✓
2. GitHub + npm + crates all return real results — ✓ (check the smoke test output mentions sources)
3. For 5 typical queries the top 3 are relevant and non-archived — manual check
4. Single-source failure degrades gracefully — covered by tests
5. Zero-config runs (no env vars set) — ✓
6. `npm test` is green — ✓
7. README documents integration — ✓

- [ ] **Step 5: Final commit (if any cleanup)**

```bash
git status
# if clean, nothing to commit
```

---

## Self-Review Notes

**Spec coverage check:**
- §3 architecture → Tasks 5–13 (all components)
- §4 tool contract → Tasks 13–14
- §5.1 GitHub adapter → Task 8
- §5.2 Registry adapter (npm/crates, PyPI skip) → Task 9
- §5.3 normalization → Task 10
- §5.4 YAGNI omissions → respected (no npm downloads, no PyPI, no README scraping, no cache)
- §6.1 classifier → Task 6
- §6.2 ranker (filter + score + intent weighting) → Task 12
- §6.3 dedupe → Task 12
- §6.4 degradation → Task 13
- §7 project structure → all tasks
- §7.2 dependencies → Task 1
- §7.3 env vars → Task 3
- §7.4 integration → Task 15
- §8 testing → every task has TDD steps
- §9 success criteria → Task 16

**Type consistency check:** `Wheel`, `RawResult` variants, `Intent`, `SearchOpts`, `SourceAdapter` interface names match across tasks. `findWheelTool.handle` signature matches what `server.ts` calls.

**Placeholder scan:** No TBD/TODO; every step has concrete code or commands.
