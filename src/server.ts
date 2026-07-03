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
import { createCache } from './cache/cache.js';
import type { WheelDetails } from './enrich/wheelDetailsEnricher.js';
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

  const findWheelTool = createFindWheelTool({
    adapters: [
      new GitHubSourceAdapter(),
      new GiteeSourceAdapter(),
      new RegistrySourceAdapter(),
      new WebSourceAdapter(),
      new GitlabSourceAdapter(),
      new PypiSourceAdapter(),
      new LibrariesIoSourceAdapter(),
    ],
    detailsCache,
    enrichOpts,
  });
  const suggestQueriesTool = createSuggestQueriesTool();
  const getWheelDetailsTool = createGetWheelDetailsTool({ cache: detailsCache, enrichOpts });

  const server = new Server(
    { name: 'findawheel', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'suggest_queries',
        description:
          'Call this FIRST to understand user intent and generate precise English search queries before searching. ' +
          'Input the user\'s original request (can be Chinese or any language), and it returns 3-4 search query variants from different angles (precise/action-oriented/fuzzy/concise). ' +
          'Workflow: (1) user says "I want to make X" → (2) call suggest_queries with user\'s original words → (3) pick the best query or combine them → (4) call find_wheel with the refined query. ' +
          'This ensures findawheel searches with optimal keywords instead of raw user input.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'User\'s original request in any language' },
            ecosystem: { type: 'string', description: 'js | ts | python | rust | go | java (optional)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'find_wheel',
        description:
          'MUST CALL THIS FIRST before any creative work — before brainstorming, before designing, before planning, before writing any code for a new feature or project. ' +
          'Search for existing reusable wheels (open-source projects, packages, APIs, CLIs, SDKs) so you avoid reinventing the wheel. ' +
          'When the user says "I want to make/build/create a ...", your FIRST action must be calling this tool (or suggest_queries first) — NOT brainstorming, NOT asking clarifying questions. ' +
          'IMPORTANT: Do NOT pass the user\'s raw words as query. First understand the intent, then craft a precise English search query (e.g., user says "我想做AI串口监控" → query should be "serial port monitor tool"). ' +
          'Only after reviewing the search results should you proceed with design/brainstorming, and even then you should reference existing wheels and explain why the user should or should not build from scratch. ' +
          'Each result includes a "match" field with recommendation level (highly_recommended/recommended/optional/not_recommended), matchScore (0-1), reason, and matchedKeywords. ' +
          'HYBRID PRESENTATION: the top 3 results include a "details" field (README snippet, code examples, latest release, license check) so you can show them directly; results ranked 4-10 have "hasDetails": true, meaning details were pre-fetched and cached — call get_wheel_details to retrieve them on demand. ' +
          'When presenting results to the user, list ALL results grouped by recommendation level (highly_recommended first), include stars/downloads and the reason — do NOT only show 1 result, give the user choices to compare. ' +
          'For top-3 results, show the README snippet and code examples to give the user a quick taste; for results with hasDetails, mention they can ask for more details.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Precise English search query (NOT raw user input). Use suggest_queries tool first if unsure.' },
            intent: { type: 'string', enum: ['feature', 'project', 'auto'], default: 'auto' },
            ecosystem: { type: 'string', description: 'js | ts | python | rust | go | java' },
            limit: { type: 'number', minimum: 1, default: 20 },
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
    return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true };
  });

  return server;
}

export async function runServer() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
