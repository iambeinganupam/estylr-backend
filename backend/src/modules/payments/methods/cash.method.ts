import { ValidationError } from '../../../lib/errors';
import { TX_METHOD } from '../../../lib/constants';
import type { PaymentMethodHandler, PaymentMethodValidationContext } from './payment-method.types';

/**
 * Cash bookings — settled offline by the vendor. Appointment is created
 * in `pending`, the customer pays in person, the vendor marks it
 * `completed` on the staff app which auto-creates a `cash` transaction.
 *
 * Risk control: cap cash bookings at ₹5,000 so a runaway customer can't
 * lock high-value slots they have no intent of honouring. The cap is
 * intentionally set here (not as an env var) so changing it requires a
 * deploy + audit trail.
 */
const CASH_BOOKING_CAP_INR = 5_000;

class CashPaymentMethod implements PaymentMethodHandler {
  readonly code = TX_METHOD.CASH;
  readonly label = 'Cash at the salon';
  readonly description = 'Pay when you arrive. Slot is reserved; no card needed.';
  readonly requiresOnlineCapture = false;
  readonly iconKey = 'cash' as const;

  assertAllowed(ctx: PaymentMethodValidationContext): void {
    if (ctx.amount > CASH_BOOKING_CAP_INR) {
      throw new ValidationError({
        payment_method:
          `Cash bookings are capped at ₹${CASH_BOOKING_CAP_INR.toLocaleString('en-IN')}. ` +
          `Pick UPI or card for this booking.`,
      });
    }
  }
}

export const cashPaymentMethod: PaymentMethodHandler = new CashPaymentMethod();
