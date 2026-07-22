// tests/server.test.ts
// M14: server.ts MCP 协议层集成测试。
// 覆盖 ListTools / CallTool / 参数校验 / unknown tool / 各工具路由正确性。
// 用 InMemoryTransport 连接真实 server 与 mock client,验证端到端协议交互。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createServer } from '../src/server.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// mock http 避免 find_wheel 真实联网
vi.mock('../src/util/http.js', () => ({
  httpGet: vi.fn().mockResolvedValue([]),
  HttpError: class HttpError extends Error {
    constructor(public status: number, public url: string, body: string) {
      super(`HTTP ${status}`);
    }
    get retryable(): boolean { return this.status >= 500; }
  },
}));

// mock cache 避免 find_wheel 真实写盘
vi.mock('../src/cache/cache.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cache/cache.js')>();
  return {
    ...actual,
    createCache: () => ({
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
      dedupe: vi.fn(async <U>(_k: string, fn: () => Promise<U>) => fn()),
    }),
    cleanupExpired: vi.fn().mockResolvedValue(0),
  };
});

// mock feedback store 避免真实写盘
vi.mock('../src/feedback/feedbackStore.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/feedback/feedbackStore.js')>();
  return {
    ...actual,
    createFeedbackStore: () => ({
      recordFeedback: vi.fn(),
      getFeedback: vi.fn().mockResolvedValue([]),
      getAllFeedback: vi.fn().mockResolvedValue([]),
    }),
  };
});

// mock knowledge base 避免真实文件系统
vi.mock('../src/tools/searchKnowledgeTool.js', () => ({
  searchKnowledge: vi.fn().mockResolvedValue({ results: [], total: 0 }),
}));

async function connectClient() {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client(
    { name: 'test-client', version: '1.0' },
    { capabilities: {} },
  );
  await client.connect(clientTransport);
  return { client, server };
}

describe('M14: server.ts MCP 协议层集成测试', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.FINDAWHEEL_CACHE_ENABLED = 'false';
  });
  afterEach(() => {
    delete process.env.FINDAWHEEL_CACHE_ENABLED;
  });

  describe('ListTools', () => {
    it('返回 5 个工具定义', async () => {
      const { client } = await connectClient();
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(5);
      const names = tools.tools.map(t => t.name).sort();
      expect(names).toEqual(['find_wheel', 'get_wheel_details', 'record_feedback', 'search_knowledge', 'suggest_queries']);
    });

    it('每个工具都有 name/description/inputSchema', async () => {
      const { client } = await connectClient();
      const tools = await client.listTools();
      for (const t of tools.tools) {
        expect(t.name).toBeTruthy();
        expect(t.description).toBeTruthy();
        expect(t.inputSchema).toBeDefined();
        expect(t.inputSchema.type).toBe('object');
      }
    });
  });

  describe('CallTool: unknown tool', () => {
    it('未知工具名返回错误,isError=true', async () => {
      const { client } = await connectClient();
      const result = await client.callTool({ name: 'nonexistent_tool', arguments: {} });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('unknown tool');
      expect(text).toContain('find_wheel');
    });
  });

  describe('CallTool: suggest_queries 参数校验', () => {
    it('缺少 query 参数返回校验错误', async () => {
      const { client } = await connectClient();
      const result = await client.callTool({ name: 'suggest_queries', arguments: {} });
      expect(result.isError).toBe(true);
    });

    it('正常调用返回 JSON 格式结果', async () => {
      const { client } = await connectClient();
      const result = await client.callTool({
        name: 'suggest_queries',
        arguments: { query: 'markdown editor' },
      });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.originalQuery).toBe('markdown editor');
      expect(parsed.suggestions).toHaveLength(4);
      expect(parsed.recommended).toBeTruthy();
    });
  });

  describe('CallTool: find_wheel 参数校验', () => {
    it('query 超过 500 字符返回校验错误', async () => {
      const { client } = await connectClient();
      const longQuery = 'a'.repeat(501);
      const result = await client.callTool({
        name: 'find_wheel',
        arguments: { query: longQuery },
      });
      expect(result.isError).toBe(true);
    });

    it('limit=0 被拒绝(positive 约束)', async () => {
      const { client } = await connectClient();
      const result = await client.callTool({
        name: 'find_wheel',
        arguments: { query: 'test', limit: 0 },
      });
      expect(result.isError).toBe(true);
    });

    it('limit=101 被拒绝(max 100)', async () => {
      const { client } = await connectClient();
      const result = await client.callTool({
        name: 'find_wheel',
        arguments: { query: 'test', limit: 101 },
      });
      expect(result.isError).toBe(true);
    });

    it('limit=100 通过(边界值)', async () => {
      const { client } = await connectClient();
      const result = await client.callTool({
        name: 'find_wheel',
        arguments: { query: 'test', limit: 100 },
      });
      // 不应因参数校验失败
      expect(result.isError).not.toBe(true);
    });

    it('intent 非法值被拒绝', async () => {
      const { client } = await connectClient();
      const result = await client.callTool({
        name: 'find_wheel',
        arguments: { query: 'test', intent: 'invalid' },
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('CallTool: record_feedback 参数校验', () => {
    it('action 非法值被拒绝', async () => {
      const { client } = await connectClient();
      const result = await client.callTool({
        name: 'record_feedback',
        arguments: { name: 'a/b', action: 'invalid' },
      });
      expect(result.isError).toBe(true);
    });

    it('缺少 action 字段被拒绝', async () => {
      const { client } = await connectClient();
      const result = await client.callTool({
        name: 'record_feedback',
        arguments: { name: 'a/b' },
      });
      expect(result.isError).toBe(true);
    });

    it('合法 like 调用不报错', async () => {
      const { client } = await connectClient();
      const result = await client.callTool({
        name: 'record_feedback',
        arguments: { name: 'a/b', action: 'like' },
      });
      expect(result.isError).not.toBe(true);
    });
  });

  describe('CallTool: get_wheel_details 参数校验', () => {
    it('缺少 name 返回校验错误', async () => {
      const { client } = await connectClient();
      const result = await client.callTool({
        name: 'get_wheel_details',
        arguments: {},
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('CallTool: search_knowledge 参数校验', () => {
    it('limit>100 被拒绝', async () => {
      const { client } = await connectClient();
      const result = await client.callTool({
        name: 'search_knowledge',
        arguments: { query: 'test', limit: 101 },
      });
      expect(result.isError).toBe(true);
    });

    it('合法调用返回 mocked 结果', async () => {
      const { client } = await connectClient();
      const result = await client.callTool({
        name: 'search_knowledge',
        arguments: { query: 'test' },
      });
      expect(result.isError).not.toBe(true);
    });
  });

  describe('exclude 数组边界值', () => {
    it('exclude 数组超过 50 个元素被拒绝', async () => {
      const { client } = await connectClient();
      const exclude = Array.from({ length: 51 }, (_, i) => `a/lib${i}`);
      const result = await client.callTool({
        name: 'find_wheel',
        arguments: { query: 'test', exclude },
      });
      expect(result.isError).toBe(true);
    });

    it('exclude 元素超过 200 字符被拒绝', async () => {
      const { client } = await connectClient();
      const result = await client.callTool({
        name: 'find_wheel',
        arguments: { query: 'test', exclude: ['a'.repeat(201)] },
      });
      expect(result.isError).toBe(true);
    });

    it('exclude 50 个元素通过(边界值)', async () => {
      const { client } = await connectClient();
      const exclude = Array.from({ length: 50 }, (_, i) => `a/lib${i}`);
      const result = await client.callTool({
        name: 'find_wheel',
        arguments: { query: 'test', exclude },
      });
      expect(result.isError).not.toBe(true);
    });
  });
});
