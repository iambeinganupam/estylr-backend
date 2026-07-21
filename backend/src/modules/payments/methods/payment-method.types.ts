// ─────────────────────────────────────────────────────────────────────────────
// Payment Method — Strategy interface (HLD)
// ─────────────────────────────────────────────────────────────────────────────
// Adding a new payment method is ONE new file (e.g., wallet.method.ts) that
// implements PaymentMethodHandler and registers itself in ./index.ts. No
// caller in booking / payments / analytics needs to change.
//
// Axis of variation: per-method validation rules, display metadata, and
// downstream capture behavior. Per CLAUDE.md §5, the variation lives behind
// a Strategy+Registry rather than a switch repeated across modules.
// ─────────────────────────────────────────────────────────────────────────────

import type { TxMethod, VendorType } from '../../../lib/constants';

/** Capability flags consumed by the booking flow + portal renderer. */
export interface PaymentMethodMetadata {
  /** Stable wire identifier, matches the DB `payment_method` enum. */
  readonly code: TxMethod;
  /** Short label shown in pickers ("UPI", "Card", "Cash"). */
  readonly label: string;
  /** Sentence explaining the flow to the customer. */
  readonly description: string;
  /**
   * True when this method completes the payment at booking time (UPI, card,
   * online gateway). False for "cash on visit" — vendor settles offline,
   * appointment is created in `pending` regardless.
   */
  readonly requiresOnlineCapture: boolean;
  /** ICON key the portal resolves to a lucide-react component. */
  readonly iconKey: 'upi' | 'card' | 'cash' | 'globe';
}

export interface PaymentMethodValidationContext {
  vendorType: VendorType;
  /** Booking total in INR (rupees), NUMERIC(10,2). e.g. 1500.00 = ₹1500. */
  amount: number;
}

export interface PaymentMethodHandler extends PaymentMethodMetadata {
  /**
   * Throws ValidationError when this method is not permitted for the given
   * booking context. Subclasses encode rules like "cash bookings capped at
   * ₹2000" or "freelancers can't accept cards" without leaking the rule
   * into the booking service.
   */
  assertAllowed(ctx: PaymentMethodValidationContext): void;
}
