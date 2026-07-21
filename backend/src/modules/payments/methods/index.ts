// ─────────────────────────────────────────────────────────────────────────────
// Payment Method — Registry + Factory
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for "what payment methods does the platform support".
// Callers ask `paymentMethod('upi').assertAllowed({...})` and `.label`;
// they never switch on the enum directly.
//
// Adding a new method (e.g. 'wallet'):
//   1. Extend the DB `payment_method` enum in a migration.
//   2. Extend TX_METHOD in src/lib/constants.ts.
//   3. Drop a new file in this folder implementing PaymentMethodHandler.
//   4. Register it in REGISTRY below.
// No other module changes.
// ─────────────────────────────────────────────────────────────────────────────

import { TX_METHOD, TX_METHODS, type TxMethod } from '../../../lib/constants';
import { ValidationError } from '../../../lib/errors';
import type {
  PaymentMethodHandler,
  PaymentMethodMetadata,
} from './payment-method.types';
import { upiPaymentMethod } from './upi.method';
import { cardPaymentMethod } from './card.method';
import { cashPaymentMethod } from './cash.method';
import { onlinePaymentMethod } from './online.method';

const REGISTRY: Readonly<Record<TxMethod, PaymentMethodHandler>> = Object.freeze({
  [TX_METHOD.UPI]:    upiPaymentMethod,
  [TX_METHOD.CARD]:   cardPaymentMethod,
  [TX_METHOD.CASH]:   cashPaymentMethod,
  [TX_METHOD.ONLINE]: onlinePaymentMethod,
});

/**
 * Factory: resolve a method code to its handler. Throws when the code is
 * unknown — defence-in-depth against mis-seeded DB rows or an upgrade
 * landing on a deploy that hasn't been re-bundled yet.
 */
export function paymentMethod(code: TxMethod | string): PaymentMethodHandler {
  const handler = REGISTRY[code as TxMethod];
  if (!handler) {
    throw new ValidationError({ payment_method: `Unsupported payment method: ${String(code)}` });
  }
  return handler;
}

/**
 * Catalogue helper for the portal's payment-method picker. Returns the
 * metadata view (no `assertAllowed`) so the wire payload stays cheap to
 * serialise and clients can't accidentally call server-side methods.
 */
export function listPaymentMethods(): readonly PaymentMethodMetadata[] {
  return TX_METHODS.map((code) => {
    const h = REGISTRY[code];
    return {
      code: h.code,
      label: h.label,
      description: h.description,
      requiresOnlineCapture: h.requiresOnlineCapture,
      iconKey: h.iconKey,
    };
  });
}

export type { PaymentMethodHandler, PaymentMethodMetadata } from './payment-method.types';
