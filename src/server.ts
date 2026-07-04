// src/server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createFindWheelTool } from './tools/findWheelTool.js';
import { createSuggestQueriesTool } from './tools/suggestQueriesTool.js';
import { createGetWheelDetailsTool } from './tools/getWheelDetailsTool.js';
import { GitHubSourceAdapter } from './sources/githubSourceAdapter.js';
import { GiteeSourceAdapter } from './sources/giteeSourceAdapter.js';
import { RegistrySourceAdapter } from './sources/registrySourceAdapter.js';
import { WebSourceAdapter } from './sources/webSourceAdapter.js';
import { GitlabSourceAdapter } from './sources/gitlabSourceAdapter.js';
import { PypiSourceAdapter } from './sources/pypiSourceAdapter.js';
import { LibrariesIoSourceAdapter } from './sources/librariesIoSourceAdapter.js';
import { GitHubCodeSourceAdapter } from './sources/githubCodeSourceAdapter.js';
import { VscodeMarketplaceSourceAdapter } from './sources/vscodeMarketplaceSourceAdapter.js';
import { PapersWithCodeSourceAdapter } from './sources/papersWithCodeSourceAdapter.js';
import { HuggingfaceSourceAdapter } from './sources/huggingfaceSourceAdapter.js';
import { createCache } from './cache/cache.js';
import type { WheelDetails } from './enrich/wheelDetailsEnricher.js';
import { createFeedbackStore } from './feedback/feedbackStore.js';
import { createRecordFeedbackTool } from './tools/recordFeedbackTool.js';
import { searchKnowledge, type SearchKnowledgeInput } from './tools/searchKnowledgeTool.js';
import type { KnowledgeItem } from './sources/knowledgeSourceAdapter.js';
import { readEnv } from './util/env.js';

const FindWheelSchema = z.object({
  query: z.string(),
  intent: z.enum(['feature', 'project', 'auto']).optional(),
  ecosystem: z.string().optional(),
  limit: z.number().int().positive().optional(),
  exclude: z.array(z.string()).optional(),
});

const SuggestQueriesSchema = z.object({
  query: z.string(),
  ecosystem: z.string().optional(),
});

const GetWheelDetailsSchema = z.object({
  name: z.string(),
});

const RecordFeedbackSchema = z.object({
  name: z.string(),
  action: z.enum(['like', 'hide', 'click']),
});

const SearchKnowledgeSchema = z.object({
  query: z.string(),
  limit: z.number().int().positive().optional(),
});

export function createServer() {
  const env = readEnv();
  // 共享详情缓存: findWheelTool 预抓取写入, getWheelDetailsTool 懒加载复用
  // 与搜索缓存放同一目录, key 空间隔离(detailsCacheKey 用 "details:" 前缀)
  const detailsCache = createCache<WheelDetails>({
    dir: env.cacheDir,
    ttlMs: env.cacheTtlMs,
    enabled: env.cacheEnabled,
  });
  // 详情抓取配置: 复用 githubToken 和 timeoutMs, 可选 userLicense 做兼容性比对
  const enrichOpts = {
    timeoutMs: env.timeoutMs,
    ...(env.githubToken ? { githubToken: env.githubToken } : {}),
    ...(env.userLicense ? { userLicense: env.userLicense } : {}),
  };

  // 反馈存储: 持久化用户对 wheel 的 like/hide/click, 影响后续搜索排序
  // 独立目录(与 cache 分离), 无 TTL, 跨会话累积
  const feedbackStore = createFeedbackStore({ dir: env.feedbackDir });

  const findWheelTool = createFindWheelTool({
    adapters: [
      new GitHubSourceAdapter(),
      new GiteeSourceAdapter(),
      new RegistrySourceAdapter(),
      new WebSourceAdapter(),
      new GitlabSourceAdapter(),
      new PypiSourceAdapter(),
      new LibrariesIoSourceAdapter(),
      new GitHubCodeSourceAdapter(),
      new VscodeMarketplaceSourceAdapter(),
      new PapersWithCodeSourceAdapter(),
      new HuggingfaceSourceAdapter(),
    ],
    detailsCache,
    enrichOpts,
    feedbackStore,
  });
  const suggestQueriesTool = createSuggestQueriesTool();
  const getWheelDetailsTool = createGetWheelDetailsTool({ cache: detailsCache, enrichOpts });
  const recordFeedbackTool = createRecordFeedbackTool({ store: feedbackStore });

  const server = new Server(
    { name: 'findawheel', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'suggest_queries',
        description:
          'Generate 4 precise English search query variants (precise/action-oriented/fuzzy/concise) from user\'s original request. CALL THIS FIRST before find_wheel.\n' +
          '\n== CORE RULES ==\n' +
          '1. Pass user\'s original words (Chinese/English/any language) as input.\n' +
          '2. Returns 4 variants + 1 recommended — pick recommended or combine variants for find_wheel.\n' +
          '3. NEVER pass raw user words to find_wheel — always go through this tool first.\n' +
          '\n== WHY CALL THIS FIRST ==\n' +
          '- AI knowledge has training cutoff → may hallucinate libraries or use outdated APIs.\n' +
          '- Real search (npm/GitHub/PyPI/...) returns real libraries, current APIs, community-vetted choices.\n' +
          '- Searching first then coding with reference = dramatically fewer AI mistakes.\n' +
          '\n== WORKFLOW ==\n' +
          '(1) user says "I want to make X" / "我想做一个..." → (2) call suggest_queries → (3) pick recommended query → (4) call find_wheel → (5) recommend 2-3 to user → (6) code with chosen wheel as reference.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'User\'s original request in any language (Chinese/English/...)' },
            ecosystem: { type: 'string', description: 'js | ts | python | rust | go | java | cpp | arduino (optional)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'find_wheel',
        description:
          'Search for existing reusable wheels (libraries, packages, APIs, CLIs, SDKs, models, snippets) BEFORE writing new code. ' +
          '\n\n== CORE RULES (must follow) ==\n' +
          '1. CALL FIRST: When user says "I want to make/build/create a ..." → call suggest_queries → find_wheel → THEN code.\n' +
          '2. DO NOT pass raw user input as query. Use suggest_queries first to get precise English search terms.\n' +
          '   Example: user says "我想做AI串口监控" → query should be "serial port monitor tool", NOT "AI串口监控".\n' +
          '3. findawheel does NOT filter by relevance — YOU judge relevance. Skip irrelevant results (e.g., "remove watermark" when user wants to ADD).\n' +
          '4. List ALL results grouped by recommendation level to user. Do NOT only show 1 — give user choices.\n' +
          '5. Recommend 2-3 best fits with reasons (compare stars/lastUpdated/description), then code with reference.\n' +
          '\n== DO NOT ==\n' +
          '- DO NOT generate code from memory without searching first (may hallucinate or use outdated APIs).\n' +
          '- DO NOT pass Chinese/raw words as query — translate via suggest_queries first.\n' +
          '- DO NOT only recommend 1 result — always give 2-3 options.\n' +
          '- DO NOT skip find_wheel because you "know" the answer — search verifies it still exists and is maintained.\n' +
          '\n== RESULT FORMAT ==\n' +
          'Each result has "match" field with: recommendation level (highly_recommended/recommended/optional/not_recommended), score (0-1), reason, matchedKeywords, recallReason.\n' +
          'recallReason explains why recalled (e.g., "命中 stepper/motor;3.0k stars;活跃维护") — use it to quickly judge relevance.\n' +
          'HYBRID PRESENTATION: top 3 include inline "details" (README/code/release/license); results 4-10 have "hasDetails": true (call get_wheel_details for details).\n' +
          '\n== AI COLLABORATION (exclude parameter) ==\n' +
          'If you identify irrelevant results, call find_wheel again with "exclude" param listing wheel names to skip — filters them without re-querying APIs. Case-insensitive match.\n' +
          '\n== WORKFLOW ==\n' +
          '(1) suggest_queries → (2) find_wheel → (3) review top 5, compare stars/lastUpdated/description → (4) recommend 2-3 with reasons → (5) code with chosen wheel as reference.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Precise English search query (NOT raw user input). Call suggest_queries first to generate this.' },
            intent: { type: 'string', enum: ['feature', 'project', 'auto'], default: 'auto' },
            ecosystem: { type: 'string', description: 'js | ts | python | rust | go | java | cpp | arduino' },
            limit: { type: 'number', minimum: 1, default: 20 },
            exclude: {
              type: 'array',
              items: { type: 'string' },
              description: 'Wheel names to exclude (e.g., ["owner/repo", "package-name"]). Filter out irrelevant results from a previous call without re-querying APIs. Case-insensitive.',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_wheel_details',
        description:
          'Retrieve detailed information (README snippet, code examples, latest release, license compatibility) for a single wheel by name. ' +
          'Use this AFTER find_wheel when you want to show the user more about a specific result that had "hasDetails": true (its details were pre-fetched and cached, so this call is instant). ' +
          'Only works for GitHub-hosted wheels (owner/repo format). Non-GitHub wheels or fetch failures return an error. ' +
          'Input: the wheel\'s "name" field exactly as returned by find_wheel (e.g., "facebook/react").',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Wheel name in owner/repo format (e.g., facebook/react)' },
          },
          required: ['name'],
        },
      },
      {
        name: 'record_feedback',
        description:
          'Record user feedback on a wheel to improve future search ranking. Call this AFTER showing find_wheel results and observing the user\'s reaction. ' +
          'Actions: "like" (user praised/selected this wheel — boosts its future ranking), "hide" (user said it\'s irrelevant — demotes it), "click" (user opened the link — small boost). ' +
          'Feedback is persisted locally (~/.findawheel/feedback/) and accumulates across sessions. ' +
          'Input: the wheel\'s "name" (owner/repo format) and the "action".',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Wheel name in owner/repo format (e.g., facebook/react)' },
            action: { type: 'string', enum: ['like', 'hide', 'click'], description: 'Feedback action: like (boost), hide (demote), click (small boost)' },
          },
          required: ['name', 'action'],
        },
      },
      {
        name: 'search_knowledge',
        description:
          'Search user\'s personal knowledge base (local Markdown notes: Obsidian vault, Logseq, plain .md folders). ' +
          'Returns documents whose title/path/tags/content match the query, with snippets and file:// URLs.\n' +
          '\n' +
          'WHEN TO CALL:\n' +
          '- User asks "what does my team\'s wiki say about X" / "团队有没有 X 的文档"\n' +
          '- User asks "find my notes on X" / "查一下我的笔记里关于 X"\n' +
          '- User asks about project ADR / architecture decisions / team conventions\n' +
          '- User mentions "internal docs" / "内部文档" / "团队规范"\n' +
          '\n' +
          'WHEN NOT TO CALL:\n' +
          '- User asks for open-source libraries → use find_wheel instead\n' +
          '- User asks how to use a library → use find_wheel + get_wheel_details\n' +
          '\n' +
          'CONFIG: Requires FINDAWHEEL_KB_ENABLED=true and FINDAWHEEL_KB_ROOT=<path> (comma-separated for multiple vaults). ' +
          'If not configured, returns a hint explaining how to enable. ' +
          'Tags are extracted from YAML frontmatter (tags:/categories:) and inline #tag. ' +
          'Search priority: title > path > tag > content.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query in any language (Chinese/English). Will be split into keywords for matching.' },
            limit: { type: 'number', description: 'Max results (default 10, max 50)' },
          },
          required: ['query'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    if (name === 'find_wheel') {
      const parsed = FindWheelSchema.safeParse(req.params.arguments);
      if (!parsed.success) {
        return { content: [{ type: 'text', text: parsed.error.message }], isError: true };
      }
      return findWheelTool.handle(parsed.data) as unknown as CallToolResult;
    }
    if (name === 'suggest_queries') {
      const parsed = SuggestQueriesSchema.safeParse(req.params.arguments);
      if (!parsed.success) {
        return { content: [{ type: 'text', text: parsed.error.message }], isError: true };
      }
      return suggestQueriesTool.handle(parsed.data) as unknown as CallToolResult;
    }
    if (name === 'get_wheel_details') {
      const parsed = GetWheelDetailsSchema.safeParse(req.params.arguments);
      if (!parsed.success) {
        return { content: [{ type: 'text', text: parsed.error.message }], isError: true };
      }
      return getWheelDetailsTool.handle(parsed.data) as unknown as CallToolResult;
    }
    if (name === 'record_feedback') {
      const parsed = RecordFeedbackSchema.safeParse(req.params.arguments);
      if (!parsed.success) {
        return { content: [{ type: 'text', text: parsed.error.message }], isError: true };
      }
      return recordFeedbackTool.handle(parsed.data) as unknown as CallToolResult;
    }
    if (name === 'search_knowledge') {
      const parsed = SearchKnowledgeSchema.safeParse(req.params.arguments);
      if (!parsed.success) {
        return { content: [{ type: 'text', text: parsed.error.message }], isError: true };
      }
      // 注入 kbCache(仅当 kbCacheEnabled=true 时生效,与 find_wheel 共享 cacheDir 但 key 空间隔离)
      const kbCache = createCache<KnowledgeItem[]>({
        dir: env.cacheDir,
        ttlMs: env.cacheTtlMs,
        enabled: env.cacheEnabled && env.kbCacheEnabled,
      });
      const result = await searchKnowledge(parsed.data as SearchKnowledgeInput, env, { cache: kbCache });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: false,
      };
    }
    return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true };
  });

  return server;
}

export async function runServer() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
