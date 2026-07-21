// ─────────────────────────────────────────────────────────────────────────────
// Analytics Module — Service
// ─────────────────────────────────────────────────────────────────────────────

import { analyticsRepository } from './analytics.repository';

export const analyticsService = {
  async getKPI(vendorId: string, range: string, start?: string, end?: string) {
    return analyticsRepository.getKPI(vendorId, range, start, end);
  },

  async getRevenueSeries(vendorId: string, range: string) {
    return analyticsRepository.getRevenueSeries(vendorId, range);
  },

  async getBookingTrends(vendorId: string, range: string) {
    return analyticsRepository.getBookingTrends(vendorId, range);
  },

  async getStaffPerformance(vendorId: string, range: string, limit: number) {
    return analyticsRepository.getStaffPerformance(vendorId, range, limit);
  },

  async getTopServices(vendorId: string, range: string, limit: number = 10) {
    return analyticsRepository.getTopServices(vendorId, range, limit);
  },

  async getCustomerInsights(vendorId: string, range: string) {
    return analyticsRepository.getCustomerInsights(vendorId, range);
  },
};
