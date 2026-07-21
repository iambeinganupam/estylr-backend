// ─────────────────────────────────────────────────────────────────────────────
// Meta Module — Repository
// ─────────────────────────────────────────────────────────────────────────────
// "Repository" here is a no-DB read source: the canonical enum values live in
// src/lib/constants.ts (which itself mirrors the Postgres ENUMs). This file
// builds the static catalogue exactly once at module load — every API call
// returns a reference to the same frozen object, so the response is a single
// JSON.stringify away with no runtime cost.
//
// To expose a new *static* enum, add it to PUBLIC_ENUMS below. To deliberately
// keep an enum backend-internal (e.g. INTENT_STATUS, LEDGER_ENTRY_TYPE),
// simply leave it out — there is no opt-out registry to maintain.
//
// staff_role is NOT in PUBLIC_ENUMS (migration 091: it stopped being a fixed
// Postgres ENUM and became the staff_roles table — a value that can change
// via a single row insert, with no deploy, doesn't belong in a "frozen at
// module load" catalogue). It's merged back into the response in
// meta.service.ts, sourced live (via a short cache) from staffService,
// so the public API response SHAPE is unchanged — GET /meta/enums still
// returns a `staff_role` key, it's just no longer static.
// ─────────────────────────────────────────────────────────────────────────────

import {
  USER_ROLE,
  GENDER_PREF,
  KYC_STATUS,
  KYC_DOC_TYPE,
  VENDOR_TYPE,
  TARGET_TYPE,
  SHIFT_TYPE,
  BOOKING_STATUS,
  BOOKING_TYPE,
  ASSIGNMENT_STATUS,
  ASSIGNMENT_ACTION,
  EVENT_STATUS,
  TX_STATUS,
  TX_METHOD,
  PLAN_CODE,
  MEDIA_TYPE,
  CMS_STATUS,
  REFUND_STATUS,
} from '../../lib/constants';

const PUBLIC_ENUMS = {
  user_role:          Object.values(USER_ROLE),
  gender_pref:        Object.values(GENDER_PREF),
  kyc_status:         Object.values(KYC_STATUS),
  kyc_doc_type:       Object.values(KYC_DOC_TYPE),
  vendor_type:        Object.values(VENDOR_TYPE),
  target_type:        Object.values(TARGET_TYPE),
  shift_type:         Object.values(SHIFT_TYPE),
  booking_status:     Object.values(BOOKING_STATUS),
  booking_type:       Object.values(BOOKING_TYPE),
  assignment_status:  Object.values(ASSIGNMENT_STATUS),
  assignment_action:  Object.values(ASSIGNMENT_ACTION),
  event_status:       Object.values(EVENT_STATUS),
  tx_status:          Object.values(TX_STATUS),
  tx_method:          Object.values(TX_METHOD),
  plan_code:          Object.values(PLAN_CODE),
  media_type:         Object.values(MEDIA_TYPE),
  cms_status:         Object.values(CMS_STATUS),
  refund_status:      Object.values(REFUND_STATUS),
} as const;

export type StaticEnumName = keyof typeof PUBLIC_ENUMS;
export type EnumName = StaticEnumName | 'staff_role';
export type EnumCatalogue = Readonly<Record<EnumName, readonly string[]>>;

const FROZEN_CATALOGUE: Readonly<Record<StaticEnumName, readonly string[]>> = Object.freeze(
  Object.fromEntries(
    Object.entries(PUBLIC_ENUMS).map(([k, v]) => [k, Object.freeze([...v])]),
  ),
) as Readonly<Record<StaticEnumName, readonly string[]>>;

export const PUBLIC_ENUM_NAMES = [...Object.keys(PUBLIC_ENUMS), 'staff_role'] as EnumName[];

export const metaRepository = {
  /** Static enum catalogue only — does not include staff_role. Returned by reference — do not mutate. */
  getStaticEnums(): Readonly<Record<StaticEnumName, readonly string[]>> {
    return FROZEN_CATALOGUE;
  },

  /** Single static enum's values. Returns `null` for unknown/dynamic names (including 'staff_role'). */
  getStaticEnum(name: string): readonly string[] | null {
    return (FROZEN_CATALOGUE as Record<string, readonly string[]>)[name] ?? null;
  },
};
