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
import { readEnv } from './util/env.js';

const FindWheelSchema = z.object({
  query: z.string(),
  intent: z.enum(['feature', 'project', 'auto']).optional(),
  ecosystem: z.string().optional(),
  limit: z.number().int().positive().optional(),
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
          'Call this FIRST to generate precise English search queries before calling find_wheel. ' +
          'Input the user\'s original request (Chinese/English/any language), and it returns 4 search query variants from different angles (precise/action-oriented/fuzzy/concise) plus a recommended one. ' +
          '\n\nWHY CALL THIS FIRST: AI knowledge has a training cutoff and may hallucinate libraries or use outdated APIs. ' +
          'Searching real wheels (npm/GitHub/PyPI/...) gives you: (1) real existing libraries (no hallucination), (2) current API usage from README, (3) community-vetted choices (stars/active maintenance), (4) license compatibility info. ' +
          'Searching first then coding with a reference wheel dramatically reduces AI mistakes vs. generating code from memory. ' +
          '\n\nWorkflow: (1) user says "I want to make X" / "我想做一个..." → (2) call suggest_queries with user\'s original words → (3) pick the recommended query or combine variants → (4) call find_wheel with the refined English query → (5) review results, compare 2-3 candidates, recommend the best fit to user → (6) THEN start coding with the chosen wheel as reference. ' +
          '\n\nDO NOT pass user\'s raw words directly to find_wheel — generate precise English search terms first via this tool.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'User\'s original request in any language (Chinese/English/...)' },
            ecosystem: { type: 'string', description: 'js | ts | python | rust | go | java (optional)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'find_wheel',
        description:
          'MUST CALL THIS FIRST before any creative work — before brainstorming, before designing, before planning, before writing any code for a new feature, new module, new project, or new code snippet. ' +
          'Search for existing reusable wheels (open-source projects, packages, APIs, CLIs, SDKs, code snippets, algorithms) so you avoid reinventing the wheel. ' +
          '\n\nWHEN TO CALL (mandatory triggers):\n' +
          '- User says "I want to make/build/create a ..." / "我想做一个/实现一个..."\n' +
          '- User asks for a new feature, new module, new project, new functionality\n' +
          '- User asks "help me write a ..." / "帮我写一个..."\n' +
          '- Any time you\'re about to generate code for something that might already exist as a library/package\n' +
          '\nWHY SEARCH FIRST (not generate from memory):\n' +
          '- AI knowledge has a training cutoff → may use outdated APIs or deprecated patterns\n' +
          '- AI may hallucinate libraries that don\'t exist → real search returns only real libraries\n' +
          '- AI may reinvent the wheel → searching shows existing solutions (don\'t write a debounce from scratch when lodash exists)\n' +
          '- AI may pick the wrong library → stars/maintenance/recency help pick the right one\n' +
          '- Searching first then coding with reference = dramatically fewer mistakes\n' +
          '\nWORKFLOW: (1) call suggest_queries first to get precise English search terms → (2) call find_wheel with the refined query → (3) review top 5 results, compare stars/lastUpdated/description → (4) recommend 2-3 best fits to user with reasons → (5) THEN start coding, referencing the chosen wheel\'s README/API.\n' +
          '\nIMPORTANT: Do NOT pass user\'s raw words as query. Use suggest_queries first to generate precise English search terms. ' +
          'Example: user says "我想做AI串口监控" → suggest_queries → query should be "serial port monitor tool", NOT "AI串口监控".\n' +
          '\nRESULT FORMAT: Each result includes a "match" field with recommendation level (highly_recommended/recommended/optional/not_recommended), matchScore (0-1), reason, and matchedKeywords. ' +
          'HYBRID PRESENTATION: top 3 results include inline "details" (README snippet, code examples, latest release, license check); results 4-10 have "hasDetails": true (call get_wheel_details for full details). ' +
          '\nIMPORTANT: findawheel does NOT filter results by relevance — it returns top N by popularity + recency + keyword match. ' +
          'YOU (the AI) must judge relevance yourself: skip irrelevant results (e.g., "remove watermark" when user wants to ADD watermark), pick the best fit for the user\'s scenario. ' +
          '\nAI COLLABORATION: Each result includes a "match.recallReason" field explaining why it was recalled (e.g., "命中 stepper/motor;3.0k stars;活跃维护"). Use this to quickly judge relevance. ' +
          'If you identify irrelevant results, call find_wheel again with the "exclude" parameter listing the wheel names to skip — this filters them out without re-querying APIs. ' +
          '\nWhen presenting to user: list ALL results grouped by recommendation level (highly_recommended first), include stars + reason — do NOT only show 1 result, give the user choices to compare.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Precise English search query (NOT raw user input). Call suggest_queries first to generate this.' },
            intent: { type: 'string', enum: ['feature', 'project', 'auto'], default: 'auto' },
            ecosystem: { type: 'string', description: 'js | ts | python | rust | go | java' },
            limit: { type: 'number', minimum: 1, default: 20 },
            exclude: {
              type: 'array',
              items: { type: 'string' },
              description: 'Wheel names to exclude from results (e.g., ["owner/repo", "package-name"]). Use this to filter out irrelevant results you identified in a previous call, without re-querying APIs. Names are matched case-insensitively.',
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
    return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true };
  });

  return server;
}

export async function runServer() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
