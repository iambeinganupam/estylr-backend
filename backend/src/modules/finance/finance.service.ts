// ─────────────────────────────────────────────────────────────────────────────
// Finance Module — Service
// ─────────────────────────────────────────────────────────────────────────────

import { financeRepository } from './finance.repository';
import { bookingRepository } from '../booking/booking.repository';
import { plansRepository } from '../plans/plans.repository';
import { getPaymentGateway } from '../../adapters';
import { env } from '../../config/env';
import {
  ResourceNotFoundError,
  TenantMismatchError,
  ConflictError,
  ValidationError,
} from '../../lib/errors';
import { assertCallerOwns } from '../../lib/ownership';
import {
  BOOKING_STATUS, TX_METHOD,
  LEDGER_ENTRY_TYPE, type VendorType,
} from '../../lib/constants';
import { buildUpiDeepLink, renderUpiQrSvg } from './upi';

/**
 * Back-calculates the GST breakdown from a tax-inclusive grand total.
 * Salon services in India are typically priced inclusive of 18% GST; we expose
 * the breakdown for the customer-facing invoice without changing what was paid.
 */
function computeTaxBreakdown(amount: number, taxRate: number) {
  const subtotal = Math.round((amount / (1 + taxRate / 100)) * 100) / 100;
  const taxAmount = Math.round((amount - subtotal) * 100) / 100;
  return { subtotal, taxAmount, taxRate };
}

function resolvePeriodDates(period: string): { start: string; end: string } {
  const now = new Date();
  const today = now.toISOString().split('T')[0]!;

  if (period === 'this_week') {
    const dayOfWeek = now.getDay();
    const start = new Date(now);
    start.setDate(now.getDate() - dayOfWeek);
    return { start: start.toISOString().split('T')[0]!, end: today };
  }
  if (period === 'last_week') {
    const dayOfWeek = now.getDay();
    const end = new Date(now);
    end.setDate(now.getDate() - dayOfWeek - 1);
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    return { start: start.toISOString().split('T')[0]!, end: end.toISOString().split('T')[0]! };
  }
  // this_month
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: start.toISOString().split('T')[0]!, end: today };
}

export const financeService = {
  async listTransactions(vendorId: string, filters: {
    fromDate?: string; toDate?: string; status?: string; limit: number;
  }) {
    return financeRepository.listTransactions(vendorId, filters);
  },

  async getTransaction(txId: string, auth: { userId: string; role: string; vendorId?: string }) {
    const owner = await financeRepository.findTransactionOwner(txId);
    if (!owner) throw new ResourceNotFoundError('Transaction');
    assertCallerOwns({
      callerRole: auth.role,
      callerUserId: auth.userId,
      callerTenantId: auth.vendorId,
      resourceOwnerUserId: undefined,
      resourceTenantId: owner.vendor_id,
    });
    return financeRepository.getTransactionById(txId);
  },

  /**
   * Compute the platform's commission cut on a vendor-collected payment.
   *
   * Subscribed vendors (paid plan, not expired) accrue **zero** commission
   * — that's the whole point of the SaaS revenue line. Pay-as-you-go
   * vendors accrue `commission_percent` of the gross.
   *
   * Returns rounded INR values so the resulting ledger row matches what
   * the UI shows the vendor down to the paisa.
   */
  async calculateCommission(
    vendorType: VendorType,
    vendorId: string,
    grossAmount: number,
  ): Promise<{ commission: number; netToVendor: number; planCode: string }> {
    const plan = await plansRepository.getEffectivePlan(vendorType, vendorId);
    const pct = plan.is_subscribed ? 0 : Number(plan.commission_percent);
    const commission = +(grossAmount * pct / 100).toFixed(2);
    const netToVendor = +(grossAmount - commission).toFixed(2);
    return { commission, netToVendor, planCode: plan.code };
  },

  /**
   * Create a payment / generate a bill for an appointment.
   *
   * Flow contract:
   *  - Appointment must exist, belong to the calling vendor, and be in
   *    `completed` state. Bills are not generated for in-progress work.
   *  - If `amount` is omitted the server uses `appointment.total_amount`
   *    (the snapshot computed at booking time). This prevents clients from
   *    inflating/discounting a COD bill from the front end.
   *  - Idempotent: re-calls for an appointment that already has a completed
   *    transaction return the existing row instead of double-billing.
   *  - COD (`payment_method='cash'`) and UPI both take a fast path —
   *    vendor-collected, no gateway round-trip, recorded as already-settled.
   *    These accrue platform commission to the dues ledger.
   *  - Card / online (gateway-mediated) is preserved for the future
   *    customer-paid Razorpay flow; commission accrual is skipped there
   *    because the gateway will deduct platform fee directly at payout.
   */
  async createPayment(
    vendorId: string,
    appointmentId: string,
    paymentMethod: string,
    currency: string,
    suppliedAmount?: number,
  ) {
    const appointment = await bookingRepository.getAppointmentById(appointmentId);
    if (!appointment) throw new ResourceNotFoundError('Appointment');
    const apt = appointment as { vendor_id: string; vendor_type: VendorType; status: string; total_amount: string | number };
    if (apt.vendor_id !== vendorId) throw new TenantMismatchError();
    if (apt.status !== BOOKING_STATUS.COMPLETED) {
      throw new ConflictError('Bill can only be generated for a completed appointment.');
    }

    const amount = suppliedAmount ?? Number(apt.total_amount ?? 0);
    // ₹0 is allowed (free / comped service) — the bill is still recorded
    // for audit. Negatives and NaN are still rejected.
    if (!Number.isFinite(amount) || amount < 0) {
      throw new ValidationError({
        fields: [{ field: 'amount', message: 'Amount cannot be negative.', code: 'invalid_amount' }],
      });
    }

    // Idempotency: surface existing settled bill instead of inserting a duplicate.
    const existing = await financeRepository.getCompletedTransactionByAppointment(appointmentId);
    if (existing) return existing;

    const breakdown = computeTaxBreakdown(amount, env.BILL_TAX_RATE);

    // Vendor-collected fast path: cash or UPI handed directly to the salon.
    // We compute the platform's commission cut, write the transaction with
    // platform_fee + vendor_payout populated, and append a ledger entry so
    // the vendor's outstanding dues stay current.
    if (paymentMethod === TX_METHOD.CASH || paymentMethod === TX_METHOD.UPI) {
      const { commission, netToVendor } = await this.calculateCommission(
        apt.vendor_type, vendorId, amount,
      );
      const tx = await financeRepository.createTransaction({
        vendorId, appointmentId, amount, currency,
        status: 'completed',
        paymentMethod,
        subtotal: breakdown.subtotal,
        taxAmount: breakdown.taxAmount,
        taxRate: breakdown.taxRate,
        platformFee: commission,
        vendorPayout: netToVendor,
        externalRef: null,
        gatewayResponse: null,
      });
      if (commission > 0) {
        await financeRepository.appendDuesLedgerEntry({
          vendorType: apt.vendor_type,
          vendorId,
          transactionId: (tx as { id: string }).id,
          entryType: LEDGER_ENTRY_TYPE.COMMISSION_ACCRUAL,
          amount: commission,
          notes: `${paymentMethod.toUpperCase()} payment — ${(commission / amount * 100).toFixed(2)}% of ₹${amount.toFixed(2)}`,
        });
      }
      return tx;
    }

    // Card / online — gateway-mediated. Commission isn't accrued here
    // because the gateway will net it out of the payout itself (future
    // Razorpay integration; left in place so the existing path works).
    const gateway = getPaymentGateway();
    const intent = await gateway.createPaymentIntent({
      amount, currency, metadata: { appointment_id: appointmentId, vendor_id: vendorId },
    });
    return financeRepository.createTransaction({
      vendorId, appointmentId, amount, currency,
      status: intent.status === 'succeeded' ? 'completed' : 'pending',
      paymentMethod,
      subtotal: breakdown.subtotal,
      taxAmount: breakdown.taxAmount,
      taxRate: breakdown.taxRate,
      externalRef: intent.gateway_ref,
      gatewayResponse: JSON.stringify(intent),
    });
  },

  /**
   * Build a UPI deep-link payload the customer can scan to pay the salon
   * directly. Resolves the salon's saved UPI ID from the vendor profile;
   * fails cleanly with a helpful error if the salon hasn't set one yet.
   *
   * The link includes the appointment id as `tr` (transaction reference)
   * so duplicate scans converge to the same payment in the bank's records.
   */
  async generateUpiQrPayload(
    vendorType: VendorType,
    vendorId: string,
    appointmentId: string,
    suppliedAmount?: number,
  ): Promise<{ upi_link: string; qr_svg: string; vpa: string; payee_name: string; amount: number; transaction_ref: string }> {
    const appointment = await bookingRepository.getAppointmentById(appointmentId);
    if (!appointment) throw new ResourceNotFoundError('Appointment');
    const apt = appointment as { vendor_id: string; status: string; total_amount: string | number; customer_name?: string };
    if (apt.vendor_id !== vendorId) throw new TenantMismatchError();
    if (apt.status !== BOOKING_STATUS.COMPLETED) {
      throw new ConflictError('UPI QR can only be generated for a completed appointment.');
    }

    const amount = suppliedAmount ?? Number(apt.total_amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ValidationError({
        fields: [{ field: 'amount', message: 'Amount must be greater than zero.', code: 'invalid_amount' }],
      });
    }

    const profile = await financeRepository.getVendorUpiProfile(vendorType, vendorId);
    if (!profile?.upi_id) {
      throw new ConflictError(
        'No UPI ID set for this vendor. Add one in Settings → Owner before generating a QR.',
      );
    }

    const payeeName = profile.upi_display_name?.trim() || profile.display_name || 'Kshuri Vendor';
    const upiLink = buildUpiDeepLink({
      payeeVpa: profile.upi_id,
      payeeName,
      amount,
      transactionNote: `Booking ${appointmentId.slice(-8).toUpperCase()}`,
      transactionRef: appointmentId,
    });
    // Server-rendered SVG so the salon UI doesn't need a QR library.
    const qrSvg = await renderUpiQrSvg(upiLink);

    return {
      upi_link: upiLink,
      qr_svg: qrSvg,
      vpa: profile.upi_id,
      payee_name: payeeName,
      amount,
      transaction_ref: appointmentId,
    };
  },

  // ── Vendor dues ──────────────────────────────────────────────────────────
  async getDues(vendorType: VendorType, vendorId: string) {
    const [outstanding, lastSettlementAt, recentEntries] = await Promise.all([
      financeRepository.getOutstandingBalance(vendorType, vendorId),
      financeRepository.getLastSettlementAt(vendorType, vendorId),
      financeRepository.listLedgerEntries(vendorType, vendorId, 25),
    ]);
    const blockThreshold = env.DUES_BLOCK_THRESHOLD_INR;
    return {
      outstanding,
      block_threshold: blockThreshold,
      is_blocked: outstanding >= blockThreshold,
      last_settlement_at: lastSettlementAt,
      platform_collection_vpa: env.PLATFORM_COLLECTION_VPA ?? null,
      platform_collection_name: env.PLATFORM_COLLECTION_NAME,
      recent_entries: recentEntries.map((e) => ({
        id: e.id,
        entry_type: e.entry_type,
        amount: Number(e.amount),
        balance_after: Number(e.balance_after),
        transaction_id: e.transaction_id,
        notes: e.notes,
        external_ref: e.external_ref,
        created_at: e.created_at,
      })),
    };
  },

  /**
   * Record a vendor → platform settlement. Phase 1 records this manually:
   * the vendor pays via UPI to the platform's collection VPA, super admin
   * confirms receipt and posts the entry. Future iterations will accept
   * this from a gateway webhook.
   */
  async recordSettlement(opts: {
    vendorType: VendorType;
    vendorId: string;
    amount: number;
    externalRef?: string;
    notes?: string;
    actingUserId: string;
  }) {
    if (!Number.isFinite(opts.amount) || opts.amount <= 0) {
      throw new ValidationError({
        fields: [{ field: 'amount', message: 'Settlement amount must be positive.', code: 'invalid_amount' }],
      });
    }
    return financeRepository.appendDuesLedgerEntry({
      vendorType: opts.vendorType,
      vendorId: opts.vendorId,
      transactionId: null,
      entryType: LEDGER_ENTRY_TYPE.SETTLEMENT_PAYMENT,
      amount: -Math.abs(opts.amount), // settlement decrements outstanding
      notes: opts.notes ?? 'Manual settlement',
      externalRef: opts.externalRef ?? null,
      createdBy: opts.actingUserId,
    });
  },

  /**
   * Quick check used by booking-flow guards (accept-pending, create-walk-in)
   * to enforce the dues threshold without each caller redoing the math.
   */
  async assertVendorNotBlocked(vendorType: VendorType, vendorId: string): Promise<void> {
    const outstanding = await financeRepository.getOutstandingBalance(vendorType, vendorId);
    if (outstanding >= env.DUES_BLOCK_THRESHOLD_INR) {
      throw new ConflictError(
        `Outstanding dues ₹${outstanding.toFixed(2)} have reached the ₹${env.DUES_BLOCK_THRESHOLD_INR} cap. Settle dues from Payments → Outstanding to continue.`,
      );
    }
  },

  async getBill(transactionId: string, vendorId: string) {
    const bill = await financeRepository.getBillByTransactionId(transactionId);
    if (!bill) throw new ResourceNotFoundError('Bill');
    if (bill.vendor_id !== vendorId) throw new TenantMismatchError();
    return bill;
  },

  async getRevenueSummary(vendorId: string) {
    return financeRepository.getRevenueSummary(vendorId);
  },

  async getPendingPayouts(businessId: string, period: string) {
    const { start, end } = resolvePeriodDates(period);
    return financeRepository.getPendingPayouts(businessId, start, end);
  },

  async processPayouts(businessId: string, staffIds: string[], periodStart: string, periodEnd: string) {
    return financeRepository.createPayoutBatch(businessId, staffIds, periodStart, periodEnd);
  },

  async getSettlements(vendorId: string) {
    return financeRepository.getSettlements(vendorId);
  },

  async getBankAccount(vendorId: string) {
    return financeRepository.getBankAccount(vendorId);
  },

  async updateBankAccount(vendorId: string, data: {
    bank_name: string; account_number: string; ifsc_code: string;
    account_holder_name: string; is_primary: boolean;
  }) {
    return financeRepository.upsertBankAccount(vendorId, {
      bankName: data.bank_name, accountNumber: data.account_number,
      ifscCode: data.ifsc_code, accountHolderName: data.account_holder_name,
      isPrimary: data.is_primary,
    });
  },

  async getExportData(vendorId: string, type: string, startDate: string, endDate: string) {
    return financeRepository.getExportData(vendorId, type, startDate, endDate);
  },

  formatCsv(rows: Record<string, unknown>[]): string {
    if (rows.length === 0) return '';
    const headers = Object.keys(rows[0]!);
    const csvLines = [headers.join(',')];
    for (const row of rows) {
      csvLines.push(headers.map(h => `"${String(row[h] ?? '')}"`).join(','));
    }
    return csvLines.join('\n');
  },
};
