// ─────────────────────────────────────────────────────────────────────────────
// Generic State Machine Engine (BP-02)
// ─────────────────────────────────────────────────────────────────────────────
// Validates status transitions for appointments, booking intents, events, etc.
// Instead of free-form PATCH { status: 'X' }, named actions enforce valid transitions.
// ─────────────────────────────────────────────────────────────────────────────

import { InvalidTransitionError } from './errors';

/**
 * A transition map defines:
 * - For each current state, which actions are valid
 * - For each action, what the next state is
 * - Optionally, which roles can perform each action
 */
export interface TransitionRule {
  to: string;
  allowedRoles?: string[];
}

export type TransitionMap = Record<string, Record<string, TransitionRule>>;

/**
 * Resolve a state transition.
 *
 * @param currentState - The current status of the entity
 * @param action - The action being performed (e.g., 'confirm', 'cancel')
 * @param transitionMap - The transition rules
 * @param actorRole - The role of the user performing the action (optional)
 *
 * @returns The new state after the transition
 * @throws InvalidTransitionError if the transition is not allowed
 */
export function resolveTransition(
  currentState: string,
  action: string,
  transitionMap: TransitionMap,
  actorRole?: string,
): string {
  const stateTransitions = transitionMap[currentState];
  if (!stateTransitions) {
    throw new InvalidTransitionError(currentState, action);
  }

  const rule = stateTransitions[action];
  if (!rule) {
    throw new InvalidTransitionError(currentState, action);
  }

  // Check role authorization if roles are specified
  if (rule.allowedRoles && actorRole && !rule.allowedRoles.includes(actorRole)) {
    throw new InvalidTransitionError(
      currentState,
      `${action} (role '${actorRole}' not authorized)`,
    );
  }

  return rule.to;
}

// ─────────────────────────────────────────────────────────────────────────────
// Appointment State Machine
// ─────────────────────────────────────────────────────────────────────────────
// pending → confirmed → in_progress → completed
//     ↓          ↓           ↓
// cancelled   cancelled   no_show
// ─────────────────────────────────────────────────────────────────────────────

export const APPOINTMENT_TRANSITIONS: TransitionMap = {
  pending: {
    confirm: { to: 'confirmed', allowedRoles: ['freelancer', 'business_admin', 'staff'] },
    cancel: { to: 'cancelled' },
  },
  confirmed: {
    // OTP path: customer-initiated bookings require OTP verification.
    'verify-otp': { to: 'in_progress', allowedRoles: ['freelancer', 'business_admin', 'staff'] },
    // Walk-in / no-OTP path: vendor-side direct start (e.g. customer already in chair).
    start: { to: 'in_progress', allowedRoles: ['freelancer', 'business_admin', 'staff'] },
    cancel: { to: 'cancelled' },
    'no-show': { to: 'no_show', allowedRoles: ['freelancer', 'business_admin', 'staff'] },
  },
  in_progress: {
    complete: { to: 'completed', allowedRoles: ['freelancer', 'business_admin', 'staff'] },
    'no-show': { to: 'no_show', allowedRoles: ['freelancer', 'business_admin', 'staff'] },
  },
  // Terminal states — no transitions allowed
  completed: {},
  cancelled: {},
  no_show: {},
};

// ─────────────────────────────────────────────────────────────────────────────
// Booking Intent State Machine
// ─────────────────────────────────────────────────────────────────────────────
// draft → locked → converted
//                → expired
// ─────────────────────────────────────────────────────────────────────────────

export const INTENT_TRANSITIONS: TransitionMap = {
  draft: {
    lock: { to: 'locked' },
    expire: { to: 'expired' },
  },
  locked: {
    convert: { to: 'converted' },
    expire: { to: 'expired' },
  },
  // Terminal states
  converted: {},
  expired: {},
};

// ─────────────────────────────────────────────────────────────────────────────
// Salon→Freelancer Assignment State Machine
// ─────────────────────────────────────────────────────────────────────────────
//   requested ─accept─→ accepted ─start─→ in_progress ─complete─→ completed
//      │                  │                   │
//      ├─decline (freelancer)                 ├─cancel (either, w/ reason)
//      └─cancel (salon)                       └─cancel (either, w/ reason)
//
// Symmetry note: only the freelancer can accept/decline an inbound request.
// Either party can cancel an in-flight assignment (with a required reason).
// ─────────────────────────────────────────────────────────────────────────────

export const ASSIGNMENT_TRANSITIONS: TransitionMap = {
  requested: {
    accept:  { to: 'accepted',  allowedRoles: ['freelancer'] },
    decline: { to: 'declined',  allowedRoles: ['freelancer'] },
    cancel:  { to: 'cancelled', allowedRoles: ['business_admin'] },
  },
  accepted: {
    start:  { to: 'in_progress', allowedRoles: ['freelancer', 'business_admin'] },
    cancel: { to: 'cancelled',   allowedRoles: ['freelancer', 'business_admin'] },
  },
  in_progress: {
    complete: { to: 'completed', allowedRoles: ['freelancer'] },
    cancel:   { to: 'cancelled', allowedRoles: ['freelancer', 'business_admin'] },
  },
  // Terminal states
  completed: {},
  declined: {},
  cancelled: {},
};
