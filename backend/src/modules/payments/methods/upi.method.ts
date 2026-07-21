import { TX_METHOD } from '../../../lib/constants';
import type { PaymentMethodHandler, PaymentMethodValidationContext } from './payment-method.types';

class UpiPaymentMethod implements PaymentMethodHandler {
  readonly code = TX_METHOD.UPI;
  readonly label = 'UPI';
  readonly description = 'Pay instantly via Google Pay, PhonePe, Paytm or any UPI app.';
  readonly requiresOnlineCapture = true;
  readonly iconKey = 'upi' as const;

  assertAllowed(_ctx: PaymentMethodValidationContext): void {
    // UPI is universally accepted in India — no per-vendor or per-amount
    // restriction at booking time. Provider-side limits (e.g., per-bank
    // single-tx caps) are enforced by the gateway during capture, not here.
  }
}

export const upiPaymentMethod: PaymentMethodHandler = new UpiPaymentMethod();
