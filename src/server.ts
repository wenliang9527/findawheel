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
import { searchKnowledge } from './tools/searchKnowledgeTool.js';
import type { KnowledgeItem } from './knowledge/knowledgeBase.js';
import { readEnv } from './util/env.js';
import { logError } from './util/logger.js';

// N1 重构:工具注册表模式
// 把 if-else 分支收敛为数据驱动的 Record<name, ToolRegistration>,
// 新增工具只需追加一个条目,无需修改 CallToolRequestSchema handler。
// handler 返回类型用 unknown(SDK 的 CallToolResult.content 是扩展联合类型,
// 我们只返回 TextContent 变体,联合赋值时不兼容,用 unknown 由运行时校验兜底)。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolHandler<T extends z.ZodTypeAny> = (data: z.infer<T>) => Promise<any> | any;

interface ToolRegistration<S extends z.ZodTypeAny> {
  schema: S;
  handler: ToolHandler<S>;
}

const FindWheelSchema = z.object({
  query: z.string().max(500),
  intent: z.enum(['feature', 'project', 'auto']).optional(),
  ecosystem: z.string().max(50).optional(),
  limit: z.number().int().positive().max(100).optional(),
  exclude: z.array(z.string().max(200)).max(50).optional(),
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
  source: z.string().optional(),
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

  // N1:工具定义与 handler 注册表
  const toolDefs = [
    {
      name: 'suggest_queries',
      description:
        'Generate 4 English search-term variants (precise/action-oriented/fuzzy/concise) from user\'s original request. CALL THIS FIRST before find_wheel — never pass raw user input to find_wheel. If output includes "recommendedEcosystem" (e.g., "arduino"/"cpp" for hardware), pass it to find_wheel\'s ecosystem param. NOTE: built-in translation covers common tech terms only; if "warning" field appears in output, translation was incomplete — you MUST translate the user intent to English yourself and retry find_wheel with your own English query.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'User\'s original request in any language (Chinese/English/...). For niche domains (e.g., 算卦/风水/中医), the built-in translation table may not cover them — check the "warning" field in the output.' },
          ecosystem: { type: 'string', description: 'js | ts | python | rust | go | java | cpp | arduino (optional)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'find_wheel',
      description:
        'Search 15 data sources for existing wheels (libraries/packages/SDKs/models) BEFORE writing new code. Call suggest_queries first. findawheel does NOT filter by relevance — YOU judge and skip irrelevant results (e.g., "remove watermark" when user wants ADD). Use "exclude" to filter on re-call without re-querying APIs.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Precise English search query (NOT raw user input). Call suggest_queries first to generate this. If the user\'s domain is niche (e.g., 算卦/风水/中医) and suggest_queries returns a "warning" field, translate the intent to English yourself instead of using the suggested query.' },
          intent: { type: 'string', enum: ['feature', 'project', 'auto'], default: 'auto' },
          ecosystem: { type: 'string', description: 'js | ts | python | rust | go | java | cpp | arduino' },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 50 },
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
        'Retrieve detailed info (README snippet, code examples, latest release, license compatibility) for a single wheel. Call AFTER find_wheel when a result had "hasDetails": true (details pre-fetched and cached, so instant). Only works for GitHub-hosted wheels (owner/repo format).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Wheel name in owner/repo format (e.g., facebook/react)' },
        },
        required: ['name'],
      },
    },
    {
      name: 'record_feedback',
      description:
        'Record user feedback on a wheel to improve future search ranking. Actions: "like" (user praised/selected — boosts), "hide" (user said irrelevant — demotes), "click" (user opened link — small boost). Call AFTER showing find_wheel results and observing user reaction. Persisted locally, accumulates across sessions.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Wheel name (e.g., facebook/react, lodash, serde) — supports multi-source name formats' },
          action: { type: 'string', enum: ['like', 'hide', 'click'], description: 'Feedback action: like (boost), hide (demote), click (small boost)' },
          source: { type: 'string', description: 'Wheel source (e.g., github/npm/pypi/crates). Optional but recommended for accurate feedback tracking.' },
        },
        required: ['name', 'action'],
      },
    },
    {
      name: 'search_knowledge',
      description:
        'Search user\'s personal knowledge base (local Markdown notes: Obsidian/Logseq/.md). Returns matching docs with snippets and file:// URLs. WHEN TO CALL: "team wiki about X" / "查笔记里关于 X" / "内部文档" / "团队规范". For open-source libraries, use find_wheel instead. Requires FINDAWHEEL_KB_ENABLED=true and FINDAWHEEL_KB_ROOT=<path>.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search query in any language (Chinese/English). Will be split into keywords for matching.' },
          limit: { type: 'number', minimum: 1, maximum: 100, description: 'Max results (default 10, max 100)' },
        },
        required: ['query'],
      },
    },
  ];

  // N1:工具 schema → handler 注册表
  // 消除 if-else 分支,新增工具只需追加一个条目
  const toolRegistry: Record<string, ToolRegistration<z.ZodTypeAny>> = {
    find_wheel: {
      schema: FindWheelSchema,
      handler: (data) => findWheelTool.handle(data as z.infer<typeof FindWheelSchema>),
    },
    suggest_queries: {
      schema: SuggestQueriesSchema,
      handler: (data) => suggestQueriesTool.handle(data as z.infer<typeof SuggestQueriesSchema>),
    },
    get_wheel_details: {
      schema: GetWheelDetailsSchema,
      handler: (data) => getWheelDetailsTool.handle(data as z.infer<typeof GetWheelDetailsSchema>),
    },
    record_feedback: {
      schema: RecordFeedbackSchema,
      handler: (data) => recordFeedbackTool.handle(data as z.infer<typeof RecordFeedbackSchema>),
    },
    search_knowledge: {
      schema: SearchKnowledgeSchema,
      handler: async (data) => {
        const result = await searchKnowledge(
          data as z.infer<typeof SearchKnowledgeSchema>,
          env,
          { cache: kbCache },
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          isError: false,
        };
      },
    },
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefs,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const entry = toolRegistry[name];
    if (!entry) {
      return {
        content: [{ type: 'text', text: `unknown tool: ${name}. Available tools: ${Object.keys(toolRegistry).join(', ')}` }],
        isError: true,
      };
    }
    const parsed = entry.schema.safeParse(req.params.arguments);
    if (!parsed.success) {
      return { content: [{ type: 'text', text: parsed.error.message }], isError: true };
    }
    // SDK 1.29 CallToolResult.content 是 ReadonlyArray<TextContent | ImageContent | AudioContent | ...>,
    // 我们只返回 TextContent 变体。handler 返回 any 由 SDK 运行时校验。
    return entry.handler(parsed.data);
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
  cleanupExpired(env.cacheDir, env.cacheTtlMs).catch(err => logError('cache cleanup failed', err));
}
