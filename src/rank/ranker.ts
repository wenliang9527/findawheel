// src/rank/ranker.ts
import type { Wheel, Intent, WheelMetrics } from '../normalize/types.js';

const THREE_YEARS_MS = 3 * 365 * 24 * 3600 * 1000;
const NOW = Date.now();

export function filterOut(wheel: Wheel): boolean {
  const m = wheel.metrics;
  if (m.archived === true) return true;
  if (m.lastUpdated) {
    const t = Date.parse(m.lastUpdated);
    if (!Number.isNaN(t) && NOW - t > THREE_YEARS_MS) return true;
  }
  if ((!wheel.description || wheel.description.trim() === '') && (m.stars ?? 0) < 10) return true;
  return false;
}

function normalize(v: number | undefined, max: number): number {
  if (v === undefined || v <= 0) return 0;
  return Math.min(v / max, 1);
}

function recencyScore(lastUpdated?: string): number {
  if (!lastUpdated) return 0;
  const t = Date.parse(lastUpdated);
  if (Number.isNaN(t)) return 0;
  const ageMs = NOW - t;
  const oneYear = 365 * 24 * 3600 * 1000;
  if (ageMs <= oneYear) return 1.0;
  if (ageMs <= 2 * oneYear) return 0.7;
  if (ageMs <= 3 * oneYear) return 0.4;
  return 0;
}

function activityScore(activity?: WheelMetrics['activity']): number {
  switch (activity) {
    case 'high': return 1.0;
    case 'medium': return 0.5;
    case 'low': return 0.2;
    default: return 0;
  }
}

export function score(wheel: Wheel, intent: Intent): number {
  const m = wheel.metrics;
  let stars = normalize(m.stars, 50000) * 0.3;
  const recency = recencyScore(m.lastUpdated) * 0.3;
  const activity = activityScore(m.activity) * 0.2;
  let downloads = normalize(m.downloads, 100000) * 0.1;
  const license = m.license ? 0.1 : 0;
  if (intent === 'feature') {
    stars *= 0.7;
    downloads *= 1.5;
  }
  return stars + recency + activity + downloads + license;
}

export function dedupe(wheels: Wheel[]): Wheel[] {
  const map = new Map<string, Wheel>();
  for (const w of wheels) {
    const key = w.name.toLowerCase();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, w);
      continue;
    }
    // Merge: keep richer metrics (more defined fields)
    const wScore = Object.values(w.metrics).filter(v => v !== undefined).length;
    const eScore = Object.values(existing.metrics).filter(v => v !== undefined).length;
    if (wScore > eScore) map.set(key, w);
  }
  return [...map.values()];
}

export function rank(wheels: Wheel[], intent: Intent, limit: number): Wheel[] {
  const filtered = wheels.filter(w => !filterOut(w));
  const deduped = dedupe(filtered);
  const scored = deduped
    .map(w => ({ w, s: score(w, intent) }))
    .sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map(x => x.w);
}
