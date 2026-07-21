// ─────────────────────────────────────────────────────────────────────────────
// UPI deep-link builder — pure helper, used to generate the QR payload that
// the salon shows to the customer at the end of a service.
//
// Format follows the NPCI "UPI Linking Specification" (BHIM/PhonePe/GPay
// compatible): `upi://pay?pa=…&pn=…&am=…&cu=INR&tn=…&tr=…`
//
//   pa  — payee VPA (e.g. salon@upi)        REQUIRED
//   pn  — payee name (URL-encoded)          REQUIRED
//   am  — amount with two decimals          REQUIRED
//   cu  — currency, fixed to INR            REQUIRED
//   tn  — transaction note (≤ 80 chars)     OPTIONAL
//   tr  — transaction reference (idempotent) OPTIONAL
//
// All inputs are validated and rejected with `ValidationError` so calling
// code can let the global error handler format a clean 400 response.
// ─────────────────────────────────────────────────────────────────────────────

import QRCode from 'qrcode';
import { ValidationError } from '../../lib/errors';

export interface UpiLinkInput {
  payeeVpa: string;
  payeeName: string;
  amount: number;
  /** Free-form note shown on the customer's UPI app. */
  transactionNote?: string;
  /** Stable reference — pass the appointment / transaction id so duplicate
   *  scans converge to the same payment in the gateway/bank ledger. */
  transactionRef?: string;
}

const VPA_RE = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/;
const MAX_NOTE_LEN = 80;

export function buildUpiDeepLink(input: UpiLinkInput): string {
  if (!VPA_RE.test(input.payeeVpa)) {
    throw new ValidationError({
      fields: [{ field: 'payeeVpa', message: 'Invalid UPI VPA format', code: 'invalid_vpa' }],
    });
  }
  if (!input.payeeName.trim()) {
    throw new ValidationError({
      fields: [{ field: 'payeeName', message: 'Payee name is required', code: 'invalid_name' }],
    });
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new ValidationError({
      fields: [{ field: 'amount', message: 'Amount must be greater than zero', code: 'invalid_amount' }],
    });
  }

  const params = new URLSearchParams();
  params.set('pa', input.payeeVpa);
  params.set('pn', input.payeeName.trim());
  params.set('am', input.amount.toFixed(2));
  params.set('cu', 'INR');
  if (input.transactionNote) {
    params.set('tn', input.transactionNote.slice(0, MAX_NOTE_LEN));
  }
  if (input.transactionRef) {
    params.set('tr', input.transactionRef);
  }
  return `upi://pay?${params.toString()}`;
}

/**
 * Render a UPI deep-link as a self-contained SVG string. The frontend
 * embeds the SVG directly (no client-side QR library needed) so customers
 * can scan with any UPI app. SVG is preferred over PNG for crisp scaling
 * and a smaller wire payload.
 *
 * Error correction level "M" (~15% damage tolerance) is the right balance
 * for printed/displayed QRs in a salon environment — readable from typical
 * customer-phone distance even with screen glare.
 */
export async function renderUpiQrSvg(upiLink: string): Promise<string> {
  return QRCode.toString(upiLink, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    color: { dark: '#000000', light: '#ffffff' },
  });
}
