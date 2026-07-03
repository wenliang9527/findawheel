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
