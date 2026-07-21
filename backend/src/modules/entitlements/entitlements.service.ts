// ─────────────────────────────────────────────────────────────────────────────
// Entitlements Module — Service
// Resolver with in-process LRU/TTL cache + LISTEN/NOTIFY invalidation.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../../config/database';
import * as repo from './entitlements.repository';
import { env } from '../../config/env';
import {
  PlanFeatureNotIncludedError,
  PlanLimitExceededError,
  FeatureDefinitionNotFoundError,
} from '../../lib/errors';

// ── Cache ──

type CacheKey = string;
const cache = new Map<CacheKey, { value: unknown; source: string; expires: number }>();
let listenClient: import('pg').Client | null = null;

function ckey(
  vendorType: string,
  vendorId: string,
  planCode: string,
  featureCode: string,
): CacheKey {
  return `${vendorType}:${vendorId}:${planCode}:${featureCode}`;
}

// ── LISTEN / NOTIFY channel ──

/**
 * Open a long-lived LISTEN connection on `entitlements_changed`.
 * Uses a dedicated pg Client (not from the pool) so it stays connected.
 * Call once at server bootstrap; idempotent if called again.
 */
export async function ensureCacheInvalidationChannel(): Promise<void> {
  if (listenClient) return;
  const { Client } = await import('pg');
  listenClient = new Client({ connectionString: env.DATABASE_URL });
  await listenClient.connect();
  await listenClient.query('LISTEN entitlements_changed');
  listenClient.on('notification', () => { cache.clear(); });
  listenClient.on('error', () => {
    // Connection dropped — clear local reference so next call reconnects
    listenClient = null;
    cache.clear();
  });
}

function notifyInvalidate(): Promise<void> {
  return query('SELECT pg_notify($1, $2)', ['entitlements_changed', 'invalidate']) as unknown as Promise<void>;
}

// ── Resolver helpers ──

export interface EntitlementCtx {
  vendorType: 'freelancer' | 'salon_location';
  vendorId: string;
  planCode: string;
}

export async function getEntitlement(ctx: EntitlementCtx, featureCode: string) {
  const k = ckey(ctx.vendorType, ctx.vendorId, ctx.planCode, featureCode);
  const cached = cache.get(k);
  if (cached && cached.expires > Date.now()) {
    return { value: cached.value, source: cached.source };
  }
  const resolved = await repo.resolveOne(ctx.vendorType, ctx.vendorId, ctx.planCode, featureCode);
  if (env.ENTITLEMENTS_CACHE_TTL_MS > 0) {
    cache.set(k, {
      value: resolved.value,
      source: resolved.source,
      expires: Date.now() + env.ENTITLEMENTS_CACHE_TTL_MS,
    });
  }
  return { value: resolved.value, source: resolved.source };
}

export async function isEnabled(ctx: EntitlementCtx, featureCode: string): Promise<boolean> {
  const { value } = await getEntitlement(ctx, featureCode);
  return value === true;
}

export async function getLimit(ctx: EntitlementCtx, featureCode: string): Promise<number | null> {
  const { value } = await getEntitlement(ctx, featureCode);
  if (value === null) return null;           // unlimited
  if (typeof value === 'number') return value;
  return null;                               // misconfigured — treat as unlimited
}

export async function assertEnabled(ctx: EntitlementCtx, featureCode: string): Promise<void> {
  const ok = await isEnabled(ctx, featureCode);
  if (!ok) throw new PlanFeatureNotIncludedError(featureCode);
}

export async function assertLimit(
  ctx: EntitlementCtx,
  featureCode: string,
  currentCount: number,
): Promise<void> {
  const limit = await getLimit(ctx, featureCode);
  if (limit === null) return;                // unlimited
  if (currentCount >= limit) throw new PlanLimitExceededError(featureCode, currentCount, limit);
}

// ── Admin CRUD (proxy + invalidate) ──

export async function listFeatures(activeOnly?: boolean) {
  return repo.listFeatures(activeOnly);
}

export async function findFeature(code: string) {
  return repo.findFeature(code);
}

export async function createFeature(args: Parameters<typeof repo.createFeature>[0]) {
  const r = await repo.createFeature(args);
  await notifyInvalidate();
  return r;
}

export async function updateFeature(code: string, patch: Parameters<typeof repo.updateFeature>[1]) {
  const r = await repo.updateFeature(code, patch);
  if (!r) throw new FeatureDefinitionNotFoundError(code);
  await notifyInvalidate();
  return r;
}

export async function listPlanEntitlementsForFeature(featureCode: string) {
  return repo.listPlanEntitlementsForFeature(featureCode);
}

export async function setPlanEntitlement(planCode: string, featureCode: string, value: unknown) {
  const r = await repo.setPlanEntitlement(planCode, featureCode, value);
  await notifyInvalidate();
  return r;
}

export async function deletePlanEntitlement(planCode: string, featureCode: string) {
  const ok = await repo.deletePlanEntitlement(planCode, featureCode);
  if (ok) await notifyInvalidate();
  return ok;
}

export async function listActiveOverridesForFeature(featureCode: string) {
  return repo.listActiveOverridesForFeature(featureCode);
}

export async function createOverride(
  args: Parameters<typeof repo.createOverride>[0],
  createdBy: string,
) {
  const r = await repo.createOverride(args, createdBy);
  await notifyInvalidate();
  return r;
}

export async function deleteOverride(id: string) {
  const ok = await repo.deleteOverride(id);
  if (ok) await notifyInvalidate();
  return ok;
}

/** Test helper — clears the in-process cache without DB round-trip. */
export function __clearCache(): void {
  cache.clear();
}
