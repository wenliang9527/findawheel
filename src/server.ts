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
        'MUST CALL THIS FIRST before any creative work — before brainstorming, before designing, before planning, before writing any code for a new feature or project. ' +
        'Search for existing reusable wheels (open-source projects, packages, APIs, CLIs, SDKs) so you avoid reinventing the wheel. ' +
        'When the user says "I want to make/build/create a ...", your FIRST action must be calling this tool — NOT brainstorming, NOT asking clarifying questions. ' +
        'Only after reviewing the search results should you proceed with design/brainstorming, and even then you should reference existing wheels and explain why the user should or should not build from scratch. ' +
        'Each result includes a "match" field with recommendation level (highly_recommended/recommended/optional/not_recommended), matchScore (0-1), reason, and matchedKeywords. ' +
        'When presenting results to the user, list ALL results grouped by recommendation level (highly_recommended first), include stars/downloads and the reason — do NOT only show 1 result, give the user choices to compare.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Feature or project idea in natural language' },
          intent: { type: 'string', enum: ['feature', 'project', 'auto'], default: 'auto' },
          ecosystem: { type: 'string', description: 'js | ts | python | rust | go | java' },
          limit: { type: 'number', minimum: 1, default: 20 },
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
