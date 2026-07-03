// src/enrich/metricsEnricher.ts
import type { Wheel, Activity } from '../normalize/types.js';

const SIX_MONTHS_MS = 180 * 24 * 3600 * 1000;
const TWO_YEARS_MS = 730 * 24 * 3600 * 1000;

export function inferActivity(lastUpdated?: string): Activity {
  if (!lastUpdated) return 'low';
  const then = Date.parse(lastUpdated);
  if (Number.isNaN(then)) return 'low';
  const age = Date.now() - then;
  if (age <= SIX_MONTHS_MS) return 'high';
  if (age <= TWO_YEARS_MS) return 'medium';
  return 'low';
}

export function enrich(wheel: Wheel): Wheel {
  return {
    ...wheel,
    metrics: {
      ...wheel.metrics,
      activity: inferActivity(wheel.metrics.lastUpdated),
    },
  };
}
