// ─────────────────────────────────────────────────────────────────────────────
// Locations module — Service
// ─────────────────────────────────────────────────────────────────────────────

import { locationsRepository } from './locations.repository';

export const locationsService = {
  /** Return the alphabetised list of cities the platform operates in. */
  async listCities(opts: { search?: string; limit: number }): Promise<string[]> {
    return locationsRepository.listDistinctCities(opts);
  },
};
