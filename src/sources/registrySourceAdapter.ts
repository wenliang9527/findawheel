// src/sources/registrySourceAdapter.ts
import type { SourceAdapter, SearchOpts } from './sourceAdapter.js';
import type { NpmRawResult, CratesRawResult, RawResult } from '../normalize/types.js';
import { httpGet, HttpError } from '../util/http.js';
import { SourceError } from '../errors.js';

interface NpmSearchResponse {
  objects: Array<{
    package: {
      name: string;
      version: string;
      description: string | null;
      links: { npm?: string; repository?: string; homepage?: string };
      keywords?: string[];
      date: string;
    };
  }>;
  total: number;
}

interface CratesSearchResponse {
  crates: Array<{
    id: string;
    name: string;
    description: string | null;
    max_version: string;
    downloads: number;
    recent_downloads: number;
    updated_at: string;
    repository: string | null;
  }>;
}

async function searchNpm(query: string, timeoutMs: number): Promise<NpmRawResult[]> {
  const url = new URL('https://registry.npmjs.org/-/v1/search');
  url.searchParams.set('text', query);
  url.searchParams.set('size', '20');
  try {
    const data = await httpGet<NpmSearchResponse>(url.toString(), { timeoutMs });
    return data.objects.map(o => ({
      source: 'npm' as const,
      name: o.package.name,
      url: o.package.links.npm ?? `https://www.npmjs.com/package/${o.package.name}`,
      description: o.package.description ?? '',
      version: o.package.version,
      keywords: o.package.keywords ?? [],
      date: o.package.date,
    }));
  } catch (err) {
    if (err instanceof HttpError) throw new SourceError('npm', `HTTP ${err.status}`);
    throw new SourceError('npm', (err as Error).message);
  }
}

async function searchCrates(query: string, timeoutMs: number): Promise<CratesRawResult[]> {
  const url = new URL('https://crates.io/api/v1/crates');
  url.searchParams.set('q', query);
  url.searchParams.set('per_page', '20');
  try {
    const data = await httpGet<CratesSearchResponse>(url.toString(), {
      timeoutMs,
      userAgent: 'findawheel/0.1 (https://github.com/findawheel)',
    });
    return data.crates.map(c => ({
      source: 'crates' as const,
      name: c.name,
      url: `https://crates.io/crates/${c.name}`,
      description: c.description ?? '',
      version: c.max_version,
      downloads: c.downloads,
      recentDownloads: c.recent_downloads,
      updatedAt: c.updated_at,
      license: null, // crates search endpoint doesn't return license
    }));
  } catch (err) {
    if (err instanceof HttpError) throw new SourceError('crates', `HTTP ${err.status}`);
    throw new SourceError('crates', (err as Error).message);
  }
}

export class RegistrySourceAdapter implements SourceAdapter {
  readonly name = 'registry';

  async search(query: string, opts: SearchOpts): Promise<RawResult[]> {
    const eco = opts.ecosystem;
    // PyPI has no search API — skip, GitHub adapter covers Python via mirror repos
    if (eco === 'python') return [];
    const tasks: Promise<RawResult[]>[] = [];
    if (!eco || eco === 'js' || eco === 'ts') {
      tasks.push(searchNpm(query, opts.timeoutMs).then(r => r as RawResult[]));
    }
    if (!eco || eco === 'rust') {
      tasks.push(searchCrates(query, opts.timeoutMs).then(r => r as RawResult[]));
    }
    const settled = await Promise.allSettled(tasks);
    const ok: RawResult[] = [];
    const errors: SourceError[] = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') ok.push(...r.value);
      else if (r.value instanceof SourceError) errors.push(r.value);
      else errors.push(new SourceError('registry', String(r.reason)));
    }
    // Re-throw only if ALL sub-sources failed AND there were tasks
    if (ok.length === 0 && errors.length > 0 && tasks.length === errors.length) {
      throw errors[0];
    }
    return ok;
  }
}
