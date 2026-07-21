// ─────────────────────────────────────────────────────────────────────────────
// Customer Finance — Service
// ─────────────────────────────────────────────────────────────────────────────
// Thin pass-through. Exists for symmetry with the project's 4-file module
// pattern and gives a stable seam for future business logic (e.g., aggregating
// loyalty points alongside transactions).
// ─────────────────────────────────────────────────────────────────────────────

import { ResourceNotFoundError } from '../../lib/errors';
import { customerFinanceRepository } from './customer-finance.repository';
import type {
  RefundsListQuery,
  TransactionsListQuery,
} from './customer-finance.schemas';

export const customerFinanceService = {
  listTransactions: (customerUserId: string, q: TransactionsListQuery) =>
    customerFinanceRepository.listTransactions(customerUserId, q),

  async getTransaction(customerUserId: string, transactionId: string) {
    const row = await customerFinanceRepository.getTransaction(customerUserId, transactionId);
    if (!row) throw new ResourceNotFoundError('Transaction');
    return row;
  },

  listRefunds: (customerUserId: string, q: RefundsListQuery) =>
    customerFinanceRepository.listRefunds(customerUserId, q),
};
