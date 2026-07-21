---
name: "findawheel-workflow"
description: "Guides AI to search for existing wheels before coding via findawheel MCP. Invoke when user says 'I want to make/build/create/implement a ...' or describes a new feature/module/project/idea."
---

# findawheel Workflow Guide

This skill ensures AI searches for existing reusable wheels (open-source projects, npm/crates packages, APIs, CLI, SDK) **before writing any new code**, following the RAG (Retrieval-Augmented Generation) paradigm.

## When to Invoke

**Mandatory triggers** (MUST call findawheel FIRST, before any creative work):

- User says: "我想做一个/做一个/帮我写一个/如何实现..." (I want to make/build/create/implement a...)
- User describes a new feature, module, project, or idea
- User asks "有没有现成的/有没有轮子" (is there an existing wheel for...)
- User wants to solve a problem that might already have an open-source solution

**Do NOT skip search even if**:
- You think you know the answer (you might hallucinate or use outdated APIs)
- The user's request seems unique (mainstream needs usually have existing solutions)
- You're a smaller model that tends to skip tool calls

## Why Search First

Four failure modes when AI skips the search:

1. **Hallucinating libraries** — citing packages that don't exist
2. **Outdated APIs** — recommending libraries with deprecated/removed APIs
3. **Reinventing the wheel** — writing code that already exists and is battle-tested
4. **Picking the wrong library** — missing better alternatives with more stars/activity

## Standard Workflow

```
Step 0: search_knowledge  →  (optional) Check local notes
Step 1: suggest_queries  →  Generate 4 search-term variants (English)
Step 2: find_wheel       →  Search with recommended variant
Step 3: Compare top 5    →  Evaluate by stars/lastUpdated/description
Step 4: Recommend 2-3    →  Present options to user with reasons
Step 5: record_feedback  →  Record user's like/hide/click
Step 6: Code              →  Only after user picks or confirms reuse
```

### Step 0: Check local knowledge (optional but recommended)

Before searching the web, check if the user has a personal knowledge base configured:

- If `FINDAWHEEL_KB_ENABLED=true` and `FINDAWHEEL_KB_ROOT` is set, call `search_knowledge` first
- This searches the user's local Markdown notes (Obsidian/Logseq/plain .md folders)
- If relevant notes found, incorporate them into your recommendations
- If no KB configured or no results, proceed to Step 1

**When to call search_knowledge:**
- User says "查笔记里关于 X" / "team wiki about X" / "内部文档"
- User mentions internal docs, team conventions, or personal notes
- You want to cross-reference open-source options with internal practices

**When NOT to call:**
- User asks about public/open-source libraries (use `find_wheel` instead)
- No FINDAWHEEL_KB_ENABLED or FINDAWHEEL_KB_ROOT configured

### Step 1: Generate search terms (suggest_queries)

**Critical**: Do NOT pass the user's original words directly to `find_wheel`. findawheel expects **English search terms**.

- If user said "我想做一个图片去水印工具", call `suggest_queries` with the original query
- findawheel translates Chinese to English internally (260+ word mapping table, including Chinese internet platforms like 小红书→xiaohongshu/rednote, embedded motion-control terms like s型加减速→s-curve-acceleration, 多个平台→multi-platform, 主题→theme)
- Intent prefix auto-stripped: 我想要/我想做/我要在我的X中增加/帮我做... → only the substantive content remains
- Filler words auto-stripped: 一个/等等/的工具/之类 → removed before translation
- Translation is idempotent: calling translateQuery twice produces the same result (no duplicate translation words)
- Pick the `recommended` variant from the output (usually `action_oriented`)
- If output includes `recommendedEcosystem` (e.g., `arduino` for hardware queries, `cpp` for STM32/ESP32, `js` for MCP server queries), pass it to `find_wheel`'s `ecosystem` parameter

### Step 2: Search (find_wheel)

Call `find_wheel` with:
- `query`: the recommended search term from step 1 (English)
- `ecosystem`: if `suggest_queries` recommended one (e.g., `js`/`ts`/`python`/`rust`/`go`/`java`/`cpp`/`arduino`)
- `intent`: `auto` (let findawheel classify feature vs project), or explicit if known
- `limit`: default 50 (don't reduce unless user asks for fewer)

**If first search has poor results** (top 1 stars < 10 or < 5 results), findawheel auto-expands to all sources. You can also:
- Try a different variant from `suggest_queries` (e.g., `fuzzy` for broader recall)
- Use `exclude` parameter to filter out irrelevant results from a previous call

### Step 3: Compare top 5

Evaluate results by these signals (findawheel does NOT hard-filter, you must judge):

| Signal | What to look for |
|--------|------------------|
| `match.recommendation` | `highly_recommended` > `recommended` > `optional` > `not_recommended` |
| `metrics.stars` | Higher = more community-validated (but not absolute — niche tools have fewer stars) |
| `metrics.lastUpdated` | Within 1 year = actively maintained; > 3 years = likely abandoned |
| `metrics.license` | MIT/Apache-2.0 = permissive; GPL = copyleft (may contaminate your project) |
| `description` | Does it actually match the user's intent? Watch for reverse-intent (e.g., "remove watermark" when user wants to add watermark) |

**Beware reverse intent**: findawheel does NOT filter by relevance. If user wants "add watermark", results may include "remove watermark" tools. You must identify and skip these. findawheel's ranker also soft-penalizes reverse-intent results (score × 0.3), but it does NOT hard-filter them — manual judgment is still required.

**Reverse intent detection in findawheel** (soft penalty, not hard filter):
- Verb-based: query has "add" → results with "remove/delete/strip" in description are soft-penalized
- Conversion pattern: query "X to Y" (e.g., "html to pdf") → results with "Y to X" / "Y2X" (e.g., "pdf to html") are soft-penalized
- Low hit rate: results matching <50% of query keywords have their stars weight ×0.2 (prevents high-star irrelevant items from dominating)

### Step 4: Recommend 2-3 options

Present options to user, not just one. Include:
- Name + stars + license + last updated
- One-line reason why it fits (or doesn't fit) the user's scenario
- Any caveats (e.g., "requires Python 3.10+", "GPL license")

Let the user choose. Don't unilaterally pick one unless they asked for "the best".

### Step 5: Record feedback (optional)

After presenting results, based on user's reaction:
- User says "这个不错" → call `record_feedback` with `action: 'like'`
- User says "这个不相关" → call `record_feedback` with `action: 'hide'`
- User clicks a link → call `record_feedback` with `action: 'click'`

Feedback persists across sessions and improves future search ranking.

### Step 6: Get details (optional)

If a result has `hasDetails: true` (ranks 4-10), call `get_wheel_details` to retrieve:
- README snippet (first 30 lines)
- Code examples (up to 2)
- Latest release tag
- License compatibility check (if `FINDAWHEEL_USER_LICENSE` is configured)

Top 3 results already have `details` inlined — no need to call `get_wheel_details`.

## How to Interpret Results

### Recommendation Levels

| Level | Score | Stars Threshold | Meaning |
|-------|-------|-----------------|---------|
| `highly_recommended` | ≥ 0.6 | ≥ 1000 (varies by source) | Strong match, high quality, actively maintained |
| `recommended` | ≥ 0.4 | — | Relevant but slightly weaker |
| `optional` | ≥ 0.2 | — | Reference only |
| `not_recommended` | < 0.2 | — | Low relevance |

### Match Score Components

findawheel's ranking (total ≤ 1.55):

```
Base score (≤1.05):
  coverage   × 0.4   ← description hits query keywords (highest weight, avoids high-star-but-irrelevant)
  stars      × 0.25  ← community validation (normalized to 50000)
  recency    × 0.2   ← continuous decay: 1yr=1.0, 1-3yr linear to 0.1
  downloads  × 0.1   ← popularity (per-source denominator)
  license    × 0.05  ← has license = 1.0
  + downloads bonus 0.05 for packages with >100k downloads (downloads cap 0.15)

Bonus (≤0.5):
  descBonus    × 0.15  ← description keyword hit rate
  nameBonus    × 0.15  ← name hit (name > description in weight)
  phraseBonus  × 0.1   ← exact phrase match
  topicsBonus  × 0.1   ← repo topics hit
```

### Feedback Delta

If user has previously given feedback, `match.feedbackDelta` shows the adjustment:
- Positive (like/click) → score boosted, ranks higher
- Negative (hide) → score reduced, ranks lower

## Common Mistakes to Avoid

1. **Skipping suggest_queries** — small models often skip this and hallucinate search terms. Always generate variants first.
2. **Passing Chinese to find_wheel** — findawheel translates internally, but passing the recommended English variant from `suggest_queries` is more reliable.
3. **Recommending only 1 result** — the workflow asks for 2-3 options. Give users choice.
4. **Ignoring reverse intent** — findawheel does NOT filter. If user wants "add watermark", you must manually skip "remove watermark" results.
5. **Forgetting record_feedback** — feedback improves future searches. Record user reactions.
6. **Calling find_wheel with user's raw words** — always generate English search terms first via `suggest_queries`.

## Quick Reference: findawheel Tools

| Tool | Purpose | When |
|------|---------|------|
| `suggest_queries` | Generate 4 English search-term variants | Before `find_wheel`, when unsure how to construct query |
| `find_wheel` | Search 15 data sources for existing wheels | **First action** when user wants to build/create something |
| `get_wheel_details` | Fetch README/code examples/release/license | When result has `hasDetails: true` (ranks 4-10) |
| `record_feedback` | Record user's like/hide/click | After presenting results, based on user reaction |
| `search_knowledge` | Search local Markdown knowledge base | When user asks about internal docs/notes (requires `FINDAWHEEL_KB_ENABLED=true`) |

## Data Sources (15)

findawheel searches these in parallel (with intelligent routing to save API quota):

GitHub · Gitee · npm · crates.io · PyPI · Maven Central · RubyGems · pkg.go.dev · GitLab · Libraries.io · GitHub Code Search · VS Code Marketplace · Papers with Code · HuggingFace · Web (Exa + Tavily)

Routing picks relevant sources based on `ecosystem` and query keywords. If results are sparse (top1 stars < 10 or < 5 results), it auto-expands to all sources.
