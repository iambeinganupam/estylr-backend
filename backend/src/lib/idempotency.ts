/**
 * Tiny in-memory idempotency cache.
 * Same key + same TTL → run the function once; subsequent calls return the
 * cached value until TTL expires. Failures are NOT cached.
 *
 * Trade-off: in-process only. Multi-instance deployments will see duplicate
 * runs across pods. Acceptable for booking intent creation because the
 * partial unique index on locked intents catches cross-instance duplicates
 * via SLOT_LOCKED — idempotency here is purely a UX nicety for retries
 * within the SAME instance.
 */

interface Entry { value: unknown; expiresAt: number; }
const CACHE = new Map<string, Entry>();
const MAX_ENTRIES = 5_000;

export async function withIdempotency<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  sweepExpired();
  const cached = CACHE.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T;
  }
  const value = await fn();
  if (CACHE.size >= MAX_ENTRIES) {
    const oldest = CACHE.keys().next().value;
    if (oldest !== undefined) CACHE.delete(oldest);
  }
  CACHE.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

function sweepExpired(): void {
  const now = Date.now();
  for (const [k, v] of CACHE) {
    if (v.expiresAt <= now) CACHE.delete(k);
  }
}

/** Test-only helper. Do not call from production code. */
export function _resetCache(): void {
  CACHE.clear();
}
