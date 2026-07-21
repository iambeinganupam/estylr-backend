// ─────────────────────────────────────────────────────────────────────────────
// Public Stats Module — Service
// ─────────────────────────────────────────────────────────────────────────────
//
// 5-minute in-process memoization. Single-instance only — fine for our
// current Node footprint (1–2 pods). When we scale horizontally we'll move
// the count to a materialized view refreshed by the cron in src/jobs/.

import { publicStatsRepository, type PublicStatsRow } from './public-stats.repository';

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry { value: PublicStatsRow; expiresAt: number; }

let cache: CacheEntry | null = null;

export const publicStatsService = {
  async getStats(): Promise<PublicStatsRow> {
    const now = Date.now();
    if (cache && cache.expiresAt > now) return cache.value;
    const value = await publicStatsRepository.getStats();
    cache = { value, expiresAt: now + CACHE_TTL_MS };
    return value;
  },

  // Exposed for tests + admin tooling.
  _invalidateCache() { cache = null; },
};
