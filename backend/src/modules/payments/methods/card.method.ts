import { TX_METHOD } from '../../../lib/constants';
import type { PaymentMethodHandler, PaymentMethodValidationContext } from './payment-method.types';

class CardPaymentMethod implements PaymentMethodHandler {
  readonly code = TX_METHOD.CARD;
  readonly label = 'Credit / Debit card';
  readonly description = 'Visa, Mastercard, Amex, RuPay. 3-D Secure handled by the gateway.';
  readonly requiresOnlineCapture = true;
  readonly iconKey = 'card' as const;

  assertAllowed(_ctx: PaymentMethodValidationContext): void {
    // Card acceptance is gateway-mediated; no per-vendor restriction at
    // booking time. Vendor-tier card-acceptance gating (e.g., only Pro+
    // freelancers can accept cards) would live here as a plan-entitlement
    // check when product asks for it.
  }
}

export const cardPaymentMethod: PaymentMethodHandler = new CardPaymentMethod();
