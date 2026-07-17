// src/server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createFindWheelTool } from './tools/findWheelTool.js';
import { createSuggestQueriesTool } from './tools/suggestQueriesTool.js';
import { createGetWheelDetailsTool } from './tools/getWheelDetailsTool.js';
import { ADAPTERS } from './sources/registry.js';
import { createCache, cleanupExpired } from './cache/cache.js';
import type { WheelDetails } from './enrich/wheelDetailsEnricher.js';
import { createFeedbackStore } from './feedback/feedbackStore.js';
import { createRecordFeedbackTool } from './tools/recordFeedbackTool.js';
import { searchKnowledge, type SearchKnowledgeInput } from './tools/searchKnowledgeTool.js';
import type { KnowledgeItem } from './knowledge/knowledgeBase.js';
import { readEnv } from './util/env.js';

const FindWheelSchema = z.object({
  query: z.string(),
  intent: z.enum(['feature', 'project', 'auto']).optional(),
  ecosystem: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
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
  limit: z.number().int().positive().max(100).optional(),
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
    adapters: ADAPTERS,
    detailsCache,
    enrichOpts,
    feedbackStore,
  });
  const suggestQueriesTool = createSuggestQueriesTool();
  const getWheelDetailsTool = createGetWheelDetailsTool({ cache: detailsCache, enrichOpts });
  const recordFeedbackTool = createRecordFeedbackTool({ store: feedbackStore });
  // 知识库缓存: 与 find_wheel 共享 cacheDir 但 key 空间隔离
  // 提到 server 顶部创建, 保留 inFlight 跨请求去重能力
  const kbCache = createCache<KnowledgeItem[]>({
    dir: env.cacheDir,
    ttlMs: env.cacheTtlMs,
    enabled: env.cacheEnabled && env.kbCacheEnabled,
  });

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
          '\n== RULES ==\n' +
          '1. Pass user\'s original words (Chinese/English/any) as input. Returns 4 variants + 1 recommended.\n' +
          '2. NEVER pass raw user words to find_wheel — always go through this tool first.\n' +
          '3. If output includes "recommendedEcosystem" (e.g., "arduino"/"cpp" for hardware queries), PASS IT to find_wheel\'s ecosystem param.\n' +
          '\n== WHY ==\n' +
          'AI knowledge has training cutoff → may hallucinate. Real search returns real libraries with current APIs.\n' +
          '\n== WORKFLOW ==\n' +
          'user says "I want to make X" → suggest_queries → pick recommended (+ use recommendedEcosystem if present) → find_wheel → recommend 2-3 → code.',
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
          'Search for existing reusable wheels (libraries/packages/APIs/CLIs/SDKs/models/snippets) BEFORE writing new code.\n' +
          '\n== CORE RULES ==\n' +
          '1. Call suggest_queries FIRST to get precise English query. DO NOT pass raw user input (e.g., "我想做AI串口监控" → use "serial port monitor tool").\n' +
          '2. findawheel does NOT filter by relevance — YOU judge. Skip irrelevant results (e.g., "remove watermark" when user wants ADD).\n' +
          '3. List ALL results grouped by recommendation level. Recommend 2-3 best fits with reasons, then code with reference.\n' +
          '\n== OUTPUT ==\n' +
          '- Each result has "match": { recommendation, score, reason, matchedKeywords, recallReason }. Use recallReason to quickly judge relevance.\n' +
          '- Top 3 include inline "details" (README/code/release); results 4-10 have "hasDetails": true (call get_wheel_details).\n' +
          '- "exclude" param: re-call with wheel names to skip irrelevant results without re-querying APIs.\n' +
          '- Intelligent routing: hardware → GitHub/Gitee, python → PyPI/GitHub. "skippedSources" field shows which sources were skipped. Auto-expands to all sources if top result stars < 10 or results < 5.\n' +
          '\n== WORKFLOW ==\n' +
          'suggest_queries → find_wheel → review top 5 → recommend 2-3 → code with reference.',
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
          'Search user\'s personal knowledge base (local Markdown notes: Obsidian/Logseq/plain .md folders). Returns matching documents with snippets and file:// URLs.\n' +
          '\nWHEN TO CALL: "what does my team\'s wiki say about X" / "查我的笔记里关于 X" / "内部文档" / "团队规范".\n' +
          'WHEN NOT TO CALL: open-source libraries → use find_wheel instead.\n' +
          '\nCONFIG: Requires FINDAWHEEL_KB_ENABLED=true and FINDAWHEEL_KB_ROOT=<path>. Search priority: title > path > tag > content.',
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
      return findWheelTool.handle(parsed.data);
    }
    if (name === 'suggest_queries') {
      const parsed = SuggestQueriesSchema.safeParse(req.params.arguments);
      if (!parsed.success) {
        return { content: [{ type: 'text', text: parsed.error.message }], isError: true };
      }
      return suggestQueriesTool.handle(parsed.data);
    }
    if (name === 'get_wheel_details') {
      const parsed = GetWheelDetailsSchema.safeParse(req.params.arguments);
      if (!parsed.success) {
        return { content: [{ type: 'text', text: parsed.error.message }], isError: true };
      }
      return getWheelDetailsTool.handle(parsed.data);
    }
    if (name === 'record_feedback') {
      const parsed = RecordFeedbackSchema.safeParse(req.params.arguments);
      if (!parsed.success) {
        return { content: [{ type: 'text', text: parsed.error.message }], isError: true };
      }
      return recordFeedbackTool.handle(parsed.data);
    }
    if (name === 'search_knowledge') {
      const parsed = SearchKnowledgeSchema.safeParse(req.params.arguments);
      if (!parsed.success) {
        return { content: [{ type: 'text', text: parsed.error.message }], isError: true };
      }
      // 使用 server 顶部创建的 kbCache(保留 inFlight 跨请求去重)
      const result = await searchKnowledge(parsed.data as SearchKnowledgeInput, env, { cache: kbCache });
      // JSON 格式与其他 tool 一致(无缩进,节省 token)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
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
  // 启动时清理过期缓存(避免长期运行后磁盘累积)
  // 复用 readEnv 派生 cacheDir/cacheTtlMs,与 createCache 取值逻辑一致
  const env = readEnv();
  cleanupExpired(env.cacheDir, env.cacheTtlMs).catch(() => {});
}
