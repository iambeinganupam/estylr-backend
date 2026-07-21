// ─────────────────────────────────────────────────────────────────────────────
// Constants — Mirrors DB ENUMs as `as const` Objects
// ─────────────────────────────────────────────────────────────────────────────
// These MUST stay in sync with PostgreSQL ENUMs defined in the schema.
// See docs/DATABASE_SCHEMA_BIBLE.md §17 — ENUM Registry.
//
// Using `as const` objects instead of TypeScript `enum` — zero runtime cost,
// tree-shakeable, and compatible with Zod's z.enum().
// ─────────────────────────────────────────────────────────────────────────────

export const USER_ROLE = {
  CUSTOMER: 'customer',
  FREELANCER: 'freelancer',
  BUSINESS_ADMIN: 'business_admin',
  STAFF: 'staff',
  EVENT_MANAGER: 'event_manager',
  SUPER_ADMIN: 'super_admin',
} as const;
export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];

export const GENDER_PREF = {
  MALE: 'male',
  FEMALE: 'female',
  UNISEX: 'unisex',
  NO_PREFERENCE: 'no_preference',
} as const;
export type GenderPref = (typeof GENDER_PREF)[keyof typeof GENDER_PREF];

export const CATEGORY_AUDIENCE = {
  GROOMING: 'grooming',
  WEDDING:  'wedding',
  BOTH:     'both',
} as const;
export type CategoryAudience = (typeof CATEGORY_AUDIENCE)[keyof typeof CATEGORY_AUDIENCE];

export const KYC_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const;
export type KycStatus = (typeof KYC_STATUS)[keyof typeof KYC_STATUS];

export const KYC_DOC_TYPE = {
  AADHAAR: 'aadhaar',
  PAN: 'pan',
  TRADE_LICENSE: 'trade_license',
} as const;
export type KycDocType = (typeof KYC_DOC_TYPE)[keyof typeof KYC_DOC_TYPE];

// STAFF_ROLE removed (migration 091): staff_role stopped being a fixed
// Postgres ENUM and became the staff_roles table, so it can no longer be
// mirrored as a compile-time constant. Query staffService.getActiveRoleCodes()
// for the current set, or SELECT code FROM staff_roles WHERE is_active.

export const VENDOR_TYPE = {
  FREELANCER: 'freelancer',
  SALON_LOCATION: 'salon_location',
} as const;
export type VendorType = (typeof VENDOR_TYPE)[keyof typeof VENDOR_TYPE];

export const TARGET_TYPE = {
  FREELANCER: 'freelancer',
  SALON_LOCATION: 'salon_location',
  STAFF_MEMBER: 'staff_member',
} as const;
export type TargetType = (typeof TARGET_TYPE)[keyof typeof TARGET_TYPE];

export const SHIFT_TYPE = {
  REGULAR_SHIFT: 'regular_shift',
  TIME_OFF: 'time_off',
  LUNCH_BREAK: 'lunch_break',
} as const;
export type ShiftType = (typeof SHIFT_TYPE)[keyof typeof SHIFT_TYPE];

export const BOOKING_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no_show',
} as const;
export type BookingStatus = (typeof BOOKING_STATUS)[keyof typeof BOOKING_STATUS];

export const BOOKING_TYPE = {
  ONLINE: 'online',
  WALKIN: 'walkin',
  KSHURI: 'kshuri',
} as const;
export type BookingType = (typeof BOOKING_TYPE)[keyof typeof BOOKING_TYPE];

export const INTENT_STATUS = {
  DRAFT: 'draft',
  LOCKED: 'locked',
  EXPIRED: 'expired',
  CONVERTED: 'converted',
  CANCELLED: 'cancelled',
} as const;
export type IntentStatus = (typeof INTENT_STATUS)[keyof typeof INTENT_STATUS];

export const ASSIGNMENT_STATUS = {
  REQUESTED: 'requested',
  ACCEPTED: 'accepted',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
} as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUS)[keyof typeof ASSIGNMENT_STATUS];

export const ASSIGNMENT_ACTION = {
  ACCEPT: 'accept',
  DECLINE: 'decline',
  START: 'start',
  COMPLETE: 'complete',
  CANCEL: 'cancel',
} as const;
export type AssignmentAction = (typeof ASSIGNMENT_ACTION)[keyof typeof ASSIGNMENT_ACTION];

export const EVENT_STATUS = {
  DRAFT: 'draft',
  PROPOSED: 'proposed',
  ACCEPTED: 'accepted',
} as const;
export type EventStatus = (typeof EVENT_STATUS)[keyof typeof EVENT_STATUS];

export const TX_STATUS = {
  PENDING: 'pending',
  SETTLED: 'settled',
  REFUNDED: 'refunded',
} as const;
export type TxStatus = (typeof TX_STATUS)[keyof typeof TX_STATUS];

export const TX_METHOD = {
  UPI: 'upi',
  CARD: 'card',
  CASH: 'cash',
  ONLINE: 'online',
} as const;
export type TxMethod = (typeof TX_METHOD)[keyof typeof TX_METHOD];
export const TX_METHODS: readonly TxMethod[] = Object.values(TX_METHOD);

// ── Subscription plans (mirrors `subscription_plans.code` seeds in 039) ────
// Codes are stable application-side references. Display name, price,
// commission % and limits are mutable rows in the catalog table — these
// constants only enumerate the *codes* that the application understands.
export const PLAN_CODE = {
  PAY_AS_YOU_GO: 'pay_as_you_go',
  BASIC: 'basic',
  PROFESSIONAL: 'professional',
  ENTERPRISE: 'enterprise',
} as const;
export type PlanCode = (typeof PLAN_CODE)[keyof typeof PLAN_CODE];

// ── Vendor dues ledger entry types (mirrors `vendor_dues_entry_type`) ──────
export const LEDGER_ENTRY_TYPE = {
  COMMISSION_ACCRUAL: 'commission_accrual',
  SETTLEMENT_PAYMENT: 'settlement_payment',
  SUBSCRIPTION_FEE: 'subscription_fee',
  ADJUSTMENT: 'adjustment',
} as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPE)[keyof typeof LEDGER_ENTRY_TYPE];

export const MEDIA_TYPE = {
  IMAGE: 'image',
  VIDEO: 'video',
} as const;
export type MediaType = (typeof MEDIA_TYPE)[keyof typeof MEDIA_TYPE];

export const CMS_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
} as const;
export type CmsStatus = (typeof CMS_STATUS)[keyof typeof CMS_STATUS];

// ── Refund flow (mirrors `refund_status` enum in migration 041) ────────────
export const REFUND_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  COMPLETED: 'completed',
} as const;
export type RefundStatus = (typeof REFUND_STATUS)[keyof typeof REFUND_STATUS];

// ── Audit log entity types (mirrors `audit_log.entity_type` in 040) ────────
// Used as the discriminator on the activity-log filter and by `recordAudit()`
// to tag rows. Keep this in sync with the entity_type values written by the
// audit-log helper across modules.
export const AUDIT_ENTITY = {
  VENDOR: 'vendor',
  CUSTOMER: 'customer',
  STAFF: 'staff',
  BOOKING: 'booking',
  KYC: 'kyc',
  COMMISSION: 'commission',
  REFUND: 'refund',
  SETTINGS: 'settings',
  CATEGORY: 'category',
  PLAN: 'plan',
  USER: 'user',
  SERVICE: 'service',
  REVIEW: 'review',
  MEDIA: 'media',
  TRANSACTION: 'transaction',
} as const;
export type AuditEntity = (typeof AUDIT_ENTITY)[keyof typeof AUDIT_ENTITY];

// ── Audit actions — dot-namespaced verbs written into `audit_log.action` ───
// Centralised so callers cannot drift on string spellings. Add new verbs here
// before using them; the activity-log filter combobox reads from this map.
export const AUDIT_ACTION = {
  VENDOR_SUSPEND:        'vendor.suspend',
  VENDOR_REINSTATE:      'vendor.reinstate',
  VENDOR_UPDATE:         'vendor.update',
  VENDOR_COMMISSION_SET: 'vendor.commission_set',

  CUSTOMER_SUSPEND:      'customer.suspend',
  CUSTOMER_REINSTATE:    'customer.reinstate',
  CUSTOMER_NOTE:         'customer.note',

  KYC_APPROVE:           'kyc.approve',
  KYC_REJECT:            'kyc.reject',
  KYC_FORCE_VERIFY:      'kyc.force_verify',

  COMMISSION_WAIVE:      'commission.waive',
  COMMISSION_ADJUST:     'commission.adjust',

  REFUND_APPROVE:        'refund.approve',
  REFUND_REJECT:         'refund.reject',
  REFUND_COMPLETE:       'refund.complete',
  REFUND_CREATE:         'refund.create',

  SETTINGS_UPDATE:       'settings.update',

  CATEGORY_CREATE:       'category.create',
  CATEGORY_UPDATE:       'category.update',
  CATEGORY_DELETE:       'category.delete',

  PLAN_CREATE:           'plan.create',
  PLAN_UPDATE:           'plan.update',
  PLAN_DELETE:           'plan.delete',

  VENDOR_CREATE:         'vendor.create',
  VENDOR_DELETE:         'vendor.delete',

  STAFF_UPDATE:          'staff.update',
  STAFF_DEACTIVATE:      'staff.deactivate',
  STAFF_REINSTATE:       'staff.reinstate',

  SERVICE_CREATE:        'service.create',
  SERVICE_UPDATE:        'service.update',
  SERVICE_DELETE:        'service.delete',

  REVIEW_HIDE:           'review.hide',
  REVIEW_UNHIDE:         'review.unhide',
  REVIEW_DELETE:         'review.delete',

  MEDIA_DELETE:          'media.delete',
  MEDIA_UPDATE:          'media.update',

  TRANSACTION_REFUND:        'transaction.refund',
  TRANSACTION_MARK_SETTLED:  'transaction.mark_settled',

  BOOKING_FORCE_CANCEL:   'booking.force_cancel',
  BOOKING_FORCE_COMPLETE: 'booking.force_complete',
  BOOKING_UPDATE:         'booking.update',
} as const;
export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

export const SERVICE_LOCATION = {
  ONSITE: 'onsite',
  HOME: 'home',
  BOTH: 'both',
} as const;
export type ServiceLocation = (typeof SERVICE_LOCATION)[keyof typeof SERVICE_LOCATION];
export const SERVICE_LOCATIONS: readonly ServiceLocation[] = Object.values(SERVICE_LOCATION);

// ── Review target kinds (mirrors `review_target_kind` enum in migration 075) ─
export const REVIEW_TARGET_KIND = {
  VENDOR:       'vendor',
  SERVICE_LINE: 'service_line',
  PRODUCT:      'product',
} as const;
export type ReviewTargetKind = (typeof REVIEW_TARGET_KIND)[keyof typeof REVIEW_TARGET_KIND];
