// ─────────────────────────────────────────────────────────────────────────────
// Error System — Centralized Error Registry (BP-04)
// ─────────────────────────────────────────────────────────────────────────────
// Every error thrown in the application extends AppError.
// The global error handler (middleware) catches these and formats them into
// the standard error envelope: { success: false, error: { code, message, details } }
//
// RULE: Never `res.status(400).json({ error: 'some string' })`.
// Always `throw new SomeError()` and let the global handler format it.
// ─────────────────────────────────────────────────────────────────────────────

// ── Error Codes ──
export const ErrorCodes = {
  // Authentication
  AUTH_INVALID_OTP: 'AUTH_INVALID_OTP',
  AUTH_OTP_EXPIRED: 'AUTH_OTP_EXPIRED',
  AUTH_EMAIL_EXISTS: 'AUTH_EMAIL_EXISTS',
  AUTH_PHONE_EXISTS: 'AUTH_PHONE_EXISTS',
  AUTH_PHONE_NOT_REGISTERED: 'AUTH_PHONE_NOT_REGISTERED',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_INSUFFICIENT_ROLE: 'AUTH_INSUFFICIENT_ROLE',
  AUTH_ROLE_MISMATCH: 'AUTH_ROLE_MISMATCH',
  AUTH_ACCOUNT_DELETED: 'AUTH_ACCOUNT_DELETED',
  AUTH_OAUTH_FAILED: 'AUTH_OAUTH_FAILED',

  // Validation
  VALIDATION_FAILED: 'VALIDATION_FAILED',

  // Resource
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',

  // Booking
  SLOT_UNAVAILABLE: 'SLOT_UNAVAILABLE',
  SLOT_LOCKED: 'SLOT_LOCKED',
  INTENT_EXPIRED: 'INTENT_EXPIRED',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  ACTIVE_INTENT_EXISTS: 'ACTIVE_INTENT_EXISTS',

  // Engagement
  DUPLICATE_REVIEW: 'DUPLICATE_REVIEW',
  REVIEW_NOT_ELIGIBLE: 'REVIEW_NOT_ELIGIBLE',

  // Business Rules
  TENANT_MISMATCH: 'TENANT_MISMATCH',
  KYC_NOT_APPROVED: 'KYC_NOT_APPROVED',
  VENDOR_NOT_VERIFIED: 'VENDOR_NOT_VERIFIED',
  APPOINTMENT_CONFLICT: 'APPOINTMENT_CONFLICT',

  // Payment
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_GATEWAY_ERROR: 'PAYMENT_GATEWAY_ERROR',

  // System
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  // General
  CONFLICT: 'CONFLICT',

  // External Services
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',

  // Addresses / Geocoding
  ADDRESS_NOT_FOUND: 'ADDRESS_NOT_FOUND',
  GEOCODER_UNAVAILABLE: 'GEOCODER_UNAVAILABLE',

  // Notifications
  NOTIFICATION_DISPATCH_FAILED: 'NOTIFICATION_DISPATCH_FAILED',
  NOTIFICATION_PREF_NOT_FOUND: 'NOTIFICATION_PREF_NOT_FOUND',

  // Entitlements / Plan-gating
  PLAN_FEATURE_NOT_INCLUDED: 'PLAN_FEATURE_NOT_INCLUDED',
  PLAN_LIMIT_EXCEEDED: 'PLAN_LIMIT_EXCEEDED',
  FEATURE_DEFINITION_NOT_FOUND: 'FEATURE_DEFINITION_NOT_FOUND',

  // KYC
  KYC_PENDING: 'KYC_PENDING',
  KYC_REJECTED: 'KYC_REJECTED',
  KYC_SUBMISSION_NOT_FOUND: 'KYC_SUBMISSION_NOT_FOUND',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// ── Base Error Class ──
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown>;
  public readonly isOperational: boolean;

  constructor(params: {
    statusCode: number;
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    isOperational?: boolean;
  }) {
    super(params.message);
    this.statusCode = params.statusCode;
    this.code = params.code;
    this.details = params.details;
    this.isOperational = params.isOperational ?? true;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

// ── Authentication Errors ──

export class InvalidOtpError extends AppError {
  constructor() {
    super({
      statusCode: 401,
      code: ErrorCodes.AUTH_INVALID_OTP,
      message: 'Invalid or expired OTP code.',
    });
  }
}

export class InvalidCredentialsError extends AppError {
  constructor() {
    super({
      statusCode: 401,
      code: ErrorCodes.AUTH_INVALID_CREDENTIALS,
      message: 'Invalid email or password.',
    });
  }
}

export class TokenExpiredError extends AppError {
  constructor() {
    super({
      statusCode: 401,
      code: ErrorCodes.AUTH_TOKEN_EXPIRED,
      message: 'Authentication token has expired.',
    });
  }
}

export class TokenInvalidError extends AppError {
  constructor() {
    super({
      statusCode: 401,
      code: ErrorCodes.AUTH_TOKEN_INVALID,
      message: 'Authentication token is invalid.',
    });
  }
}

export class EmailExistsError extends AppError {
  constructor() {
    super({
      statusCode: 409,
      code: ErrorCodes.AUTH_EMAIL_EXISTS,
      message: 'An account with this email already exists.',
    });
  }
}

export class PhoneExistsError extends AppError {
  /**
   * `existingRole` is surfaced in error.details so the calling client can
   * show a targeted message ("registered as a Salon — sign in there") and
   * deep-link to the right dashboard, rather than a generic "already
   * registered" prompt that strands the user on the wrong app.
   */
  constructor(opts?: { existingRole?: string }) {
    super({
      statusCode: 409,
      code: ErrorCodes.AUTH_PHONE_EXISTS,
      message: 'An account with this phone number already exists.',
      details: opts?.existingRole ? { existing_role: opts.existingRole } : undefined,
    });
  }
}

/**
 * Thrown at the auth boundary when a phone-OTP login (`lookup_only=true`)
 * verifies successfully but no user exists for the calling audience —
 * meaning the caller should be routed to the audience's signup flow with
 * the just-verified idToken handoff, instead of having a placeholder
 * account silently auto-created for them.
 */
export class PhoneNotRegisteredError extends AppError {
  constructor(opts?: { audience?: string }) {
    super({
      statusCode: 404,
      code: ErrorCodes.AUTH_PHONE_NOT_REGISTERED,
      message: 'No account is registered with this phone number on this dashboard.',
      details: opts?.audience ? { audience: opts.audience } : undefined,
    });
  }
}

export class InsufficientRoleError extends AppError {
  constructor(requiredRoles?: string[]) {
    super({
      statusCode: 403,
      code: ErrorCodes.AUTH_INSUFFICIENT_ROLE,
      message: 'You do not have permission to perform this action.',
      details: requiredRoles ? { required_roles: requiredRoles } : undefined,
    });
  }
}

/**
 * Thrown at the auth boundary when a user's role is not authorised for the
 * audience (dashboard) they are trying to enter — e.g. a freelancer signing
 * in to the salon dashboard. Issued instead of access tokens so no session
 * is established.
 *
 * The user-facing `message` deliberately does NOT reveal the user's actual
 * role — each dashboard treats mismatches as "no account on file" and
 * directs the user to register on the correct dashboard. The `details`
 * payload (existing_role) is for server-side logs/audit only.
 */
export class RoleMismatchError extends AppError {
  constructor(params: { audience: string; existingRole: string }) {
    super({
      statusCode: 403,
      code: ErrorCodes.AUTH_ROLE_MISMATCH,
      message: `This account is not authorised for the ${params.audience} dashboard. Please create an account or sign in on the correct dashboard.`,
      details: {
        audience: params.audience,
        existing_role: params.existingRole,
      },
    });
  }
}

export class OAuthError extends AppError {
  constructor(message = 'OAuth authentication failed.') {
    super({
      statusCode: 401,
      code: ErrorCodes.AUTH_OAUTH_FAILED,
      message,
    });
  }
}

// ── Validation Errors ──

export class ValidationError extends AppError {
  constructor(details: Record<string, unknown>) {
    super({
      statusCode: 400,
      code: ErrorCodes.VALIDATION_FAILED,
      message: 'Request validation failed.',
      details,
    });
  }
}

// ── Resource Errors ──

export class ResourceNotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super({
      statusCode: 404,
      code: ErrorCodes.RESOURCE_NOT_FOUND,
      message: `${resource} not found.`,
    });
  }
}

// ── Booking Errors ──

export class SlotUnavailableError extends AppError {
  constructor(details?: Record<string, unknown>) {
    super({
      statusCode: 409,
      code: ErrorCodes.SLOT_UNAVAILABLE,
      message: 'This time slot is not available.',
      details,
    });
  }
}

export class SlotLockedError extends AppError {
  constructor(details?: Record<string, unknown>) {
    super({
      statusCode: 409,
      code: ErrorCodes.SLOT_LOCKED,
      message: 'This time slot is already locked by another customer.',
      details,
    });
  }
}

export class IntentExpiredError extends AppError {
  constructor() {
    super({
      statusCode: 410,
      code: ErrorCodes.INTENT_EXPIRED,
      message: 'This booking intent has expired. Please start over.',
    });
  }
}

export class InvalidTransitionError extends AppError {
  constructor(currentStatus: string, attemptedAction: string) {
    super({
      statusCode: 422,
      code: ErrorCodes.INVALID_TRANSITION,
      message: `Cannot ${attemptedAction}. Current status: ${currentStatus}.`,
      details: { current_status: currentStatus, attempted_action: attemptedAction },
    });
  }
}

// ── Engagement Errors ──

export class DuplicateReviewError extends AppError {
  constructor() {
    super({
      statusCode: 409,
      code: ErrorCodes.DUPLICATE_REVIEW,
      message: 'A review already exists for this appointment.',
    });
  }
}

export class ReviewNotEligibleError extends AppError {
  constructor(message = 'Reviews can only be submitted for completed appointments.') {
    super({
      statusCode: 422,
      code: ErrorCodes.REVIEW_NOT_ELIGIBLE,
      message,
    });
  }
}

// ── Tenant Errors ──

export class TenantMismatchError extends AppError {
  constructor() {
    super({
      statusCode: 403,
      code: ErrorCodes.TENANT_MISMATCH,
      message: 'You do not have access to this resource.',
    });
  }
}

// ── Payment Errors ──

export class PaymentFailedError extends AppError {
  constructor(details?: Record<string, unknown>) {
    super({
      statusCode: 402,
      code: ErrorCodes.PAYMENT_FAILED,
      message: 'Payment processing failed.',
      details,
    });
  }
}

// ── System Errors ──

export class DatabaseError extends AppError {
  constructor(message = 'A database error occurred.') {
    super({
      statusCode: 500,
      code: ErrorCodes.DATABASE_ERROR,
      message,
      isOperational: false,
    });
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests. Please try again later.') {
    super({
      statusCode: 429,
      code: ErrorCodes.RATE_LIMIT_EXCEEDED,
      message,
    });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict with current resource state.') {
    super({
      statusCode: 409,
      code: ErrorCodes.CONFLICT,
      message,
    });
  }
}

export class ExternalServiceError extends AppError {
  constructor(details: Record<string, unknown> = {}) {
    super({
      statusCode: 503,
      code: ErrorCodes.EXTERNAL_SERVICE_ERROR,
      message: typeof details.message === 'string' ? details.message : 'External service unavailable.',
      details,
    });
  }
}

export class AddressNotFoundError extends AppError {
  constructor(id?: string) {
    super({
      statusCode: 404,
      code: ErrorCodes.ADDRESS_NOT_FOUND,
      message: `Address ${id ?? ''} not found`.trim(),
    });
  }
}

export class GeocoderUnavailableError extends AppError {
  constructor(reason: string) {
    super({
      statusCode: 503,
      code: ErrorCodes.GEOCODER_UNAVAILABLE,
      message: `Geocoder unavailable: ${reason}`,
    });
  }
}

// ── Notification Errors ──

export class NotificationDispatchError extends AppError {
  constructor(details: Record<string, unknown>) {
    super({
      statusCode: 500,
      code: ErrorCodes.NOTIFICATION_DISPATCH_FAILED,
      message: 'Notification dispatch failed',
      details,
    });
  }
}

export class NotificationPreferenceNotFoundError extends AppError {
  constructor(userId: string) {
    super({
      statusCode: 404,
      code: ErrorCodes.NOTIFICATION_PREF_NOT_FOUND,
      message: `No notification preferences for user ${userId}`,
    });
  }
}

// ── Entitlement Errors ──

export class PlanFeatureNotIncludedError extends AppError {
  constructor(featureCode: string) {
    super({
      statusCode: 403,
      code: ErrorCodes.PLAN_FEATURE_NOT_INCLUDED,
      message: `Your current plan does not include the '${featureCode}' feature.`,
      details: { feature_code: featureCode },
    });
  }
}

export class PlanLimitExceededError extends AppError {
  constructor(featureCode: string, current: number, limit: number) {
    super({
      statusCode: 403,
      code: ErrorCodes.PLAN_LIMIT_EXCEEDED,
      message: `Plan limit reached for '${featureCode}': ${current} of ${limit} used.`,
      details: { feature_code: featureCode, current, limit },
    });
  }
}

export class FeatureDefinitionNotFoundError extends AppError {
  constructor(code: string) {
    super({
      statusCode: 404,
      code: ErrorCodes.FEATURE_DEFINITION_NOT_FOUND,
      message: `Feature definition '${code}' not found.`,
      details: { code },
    });
  }
}

// ── KYC Errors ──

export class KycPendingError extends AppError {
  constructor(details?: Record<string, unknown>) {
    super({
      statusCode: 403,
      code: ErrorCodes.KYC_PENDING,
      message: 'KYC verification pending; cannot access this resource yet.',
      details,
    });
  }
}

export class KycRejectedError extends AppError {
  constructor(reason: string) {
    super({
      statusCode: 403,
      code: ErrorCodes.KYC_REJECTED,
      message: `KYC rejected: ${reason}`,
    });
  }
}

export class KycSubmissionNotFoundError extends AppError {
  constructor(id: string) {
    super({
      statusCode: 404,
      code: ErrorCodes.KYC_SUBMISSION_NOT_FOUND,
      message: `KYC submission ${id} not found`,
    });
  }
}
