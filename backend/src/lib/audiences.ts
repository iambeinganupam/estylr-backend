// ─────────────────────────────────────────────────────────────────────────────
// Audiences — Per-Dashboard Authentication Scopes
// ─────────────────────────────────────────────────────────────────────────────
// Each Kshuri dashboard ("audience") may only authenticate users whose role is
// in its allowlist. Auth tokens are bound to the audience that requested them
// — refresh cookies are named per audience, and `/auth/refresh` only accepts
// the cookie matching the audience header. A salon admin's session cookie
// therefore can NEVER be used to log a freelancer dashboard back in (and vice
// versa), even on a shared `localhost` host where cookies would otherwise
// bleed across ports.
//
// This is the server-authoritative half of the role gate. The frontend gate
// in `@kshuri/api-client/utils/roles` is defense-in-depth.
// ─────────────────────────────────────────────────────────────────────────────

import { USER_ROLE, type UserRole } from './constants';

/** Header carrying the audience identifier on every /auth/* request. */
export const AUDIENCE_HEADER = 'x-kshuri-audience';

export const AUDIENCES = {
  salon: { roles: [USER_ROLE.BUSINESS_ADMIN] },
  freelancer: { roles: [USER_ROLE.FREELANCER] },
  staff: { roles: [USER_ROLE.STAFF] },
  customer: { roles: [USER_ROLE.CUSTOMER] },
  events: { roles: [USER_ROLE.EVENT_MANAGER] },
  admin: { roles: [USER_ROLE.SUPER_ADMIN] },
} as const satisfies Record<string, { roles: readonly UserRole[] }>;

export type AudienceKey = keyof typeof AUDIENCES;
export const AUDIENCE_KEYS = Object.keys(AUDIENCES) as AudienceKey[];

const REFRESH_COOKIE_PREFIX = 'kshuri_rt';

/** Name of the audience-scoped refresh-token cookie. */
export function refreshCookieName(audience: AudienceKey): string {
  return `${REFRESH_COOKIE_PREFIX}_${audience}`;
}

export function isAudienceKey(value: unknown): value is AudienceKey {
  return typeof value === 'string' && (AUDIENCE_KEYS as string[]).includes(value);
}

/** True if `role` is allowed to authenticate against `audience`. */
export function isRoleAllowedForAudience(role: UserRole, audience: AudienceKey): boolean {
  return (AUDIENCES[audience].roles as readonly UserRole[]).includes(role);
}
