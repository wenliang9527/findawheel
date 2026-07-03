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
    return tool.handle(parsed.data) as unknown as CallToolResult;
  });

  return server;
}

export async function runServer() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
