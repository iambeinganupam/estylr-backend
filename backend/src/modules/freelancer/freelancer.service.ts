// ─────────────────────────────────────────────────────────────────────────────
// Freelancer Module — Service (business logic orchestration)
// ─────────────────────────────────────────────────────────────────────────────
// Thin orchestration. The repository is the source of SQL truth; the service
// handles defaults, validation rules that span multiple resources, and caching
// for the computed performance endpoint.
// ─────────────────────────────────────────────────────────────────────────────

import { ResourceNotFoundError } from '../../lib/errors';
import {
  freelancerRepository,
  type ExperienceRow,
  type FreelancerProfileRow,
  type SalonAssociationRow,
  type SkillRow,
} from './freelancer.repository';

// ── Performance cache ────────────────────────────────────────────────────────
// Lightweight in-memory memo: 60-second TTL keyed by `${freelancerId}|${range}`.
// The query is moderately expensive and tends to be hit multiple times per
// dashboard render (Profile + Dashboard concurrently).
const PERFORMANCE_TTL_MS = 60_000;
const performanceCache = new Map<
  string,
  { value: Awaited<ReturnType<typeof freelancerRepository.getPerformanceMetrics>>; expiresAt: number }
>();

export interface FreelancerPresence {
  is_online: boolean;
  online_since_at: string | null;
}

function rangeBounds(range: '7d' | '30d' | '90d' | '1y'): { start: string; end: string } {
  const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 365;
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

// ── Skill grouping helper ────────────────────────────────────────────────────

interface SkillGroup {
  category: string;
  items: Array<{ id: string; name: string; endorsement_count: number }>;
}

function groupSkills(rows: SkillRow[]): SkillGroup[] {
  const map = new Map<string, SkillGroup>();
  for (const row of rows) {
    const group = map.get(row.category) ?? { category: row.category, items: [] };
    group.items.push({
      id: row.id,
      name: row.skill_name,
      endorsement_count: row.endorsement_count,
    });
    map.set(row.category, group);
  }
  return [...map.values()];
}

// ── Service ──────────────────────────────────────────────────────────────────

export const freelancerService = {
  // ── Profile ───────────────────────────────────────────────────────────────

  async getProfile(freelancerId: string): Promise<FreelancerProfileRow> {
    const profile = await freelancerRepository.getProfile(freelancerId);
    if (!profile) throw new ResourceNotFoundError('Freelancer profile');
    return profile;
  },

  async updateProfile(
    freelancerId: string,
    patch: Record<string, unknown>,
  ): Promise<FreelancerProfileRow> {
    const updated = await freelancerRepository.updateProfile(freelancerId, patch);
    if (!updated) throw new ResourceNotFoundError('Freelancer profile');
    // Profile mutations may invalidate cached metrics indirectly (e.g., commission_pct).
    performanceCache.clear();
    return updated;
  },

  // ── Presence ──────────────────────────────────────────────────────────────

  async setPresence(
    freelancerId: string,
    isOnline: boolean,
  ): Promise<FreelancerPresence> {
    const row = await freelancerRepository.setPresence(freelancerId, isOnline);
    if (!row) throw new ResourceNotFoundError('Freelancer profile');
    return {
      is_online: row.is_open_to_work,
      online_since_at: row.online_since_at,
    };
  },

  // ── Experience ────────────────────────────────────────────────────────────

  async listExperience(freelancerId: string): Promise<ExperienceRow[]> {
    return freelancerRepository.listExperience(freelancerId);
  },

  async createExperience(
    freelancerId: string,
    input: Parameters<typeof freelancerRepository.createExperience>[1],
  ) {
    return freelancerRepository.createExperience(freelancerId, input);
  },

  async updateExperience(
    freelancerId: string,
    experienceId: string,
    patch: Record<string, unknown>,
  ): Promise<ExperienceRow> {
    const updated = await freelancerRepository.updateExperience(freelancerId, experienceId, patch);
    if (!updated) throw new ResourceNotFoundError('Experience entry');
    return updated;
  },

  async deleteExperience(freelancerId: string, experienceId: string): Promise<void> {
    const ok = await freelancerRepository.deleteExperience(freelancerId, experienceId);
    if (!ok) throw new ResourceNotFoundError('Experience entry');
  },

  // ── Skills ────────────────────────────────────────────────────────────────

  async listSkills(freelancerId: string): Promise<SkillGroup[]> {
    const rows = await freelancerRepository.listSkills(freelancerId);
    return groupSkills(rows);
  },

  async createSkill(
    freelancerId: string,
    input: { category: string; skill_name: string },
  ): Promise<SkillRow> {
    return freelancerRepository.createSkill(freelancerId, input);
  },

  async deleteSkill(freelancerId: string, skillId: string): Promise<void> {
    const ok = await freelancerRepository.deleteSkill(freelancerId, skillId);
    if (!ok) throw new ResourceNotFoundError('Skill');
  },

  // ── Certifications ────────────────────────────────────────────────────────

  async listCertifications(freelancerId: string) {
    return freelancerRepository.listCertifications(freelancerId);
  },

  async createCertification(
    freelancerId: string,
    input: Parameters<typeof freelancerRepository.createCertification>[1],
  ) {
    return freelancerRepository.createCertification(freelancerId, input);
  },

  async deleteCertification(freelancerId: string, certificationId: string): Promise<void> {
    const ok = await freelancerRepository.deleteCertification(freelancerId, certificationId);
    if (!ok) throw new ResourceNotFoundError('Certification');
  },

  // ── Languages ─────────────────────────────────────────────────────────────

  async listLanguages(freelancerId: string) {
    return freelancerRepository.listLanguages(freelancerId);
  },

  async createLanguage(
    freelancerId: string,
    input: { language: string; proficiency?: string },
  ) {
    return freelancerRepository.createLanguage(freelancerId, input);
  },

  async deleteLanguage(freelancerId: string, languageId: string): Promise<void> {
    const ok = await freelancerRepository.deleteLanguage(freelancerId, languageId);
    if (!ok) throw new ResourceNotFoundError('Language');
  },

  // ── Salon Associations ────────────────────────────────────────────────────

  async listSalonAssociations(freelancerId: string): Promise<SalonAssociationRow[]> {
    return freelancerRepository.listSalonAssociations(freelancerId);
  },

  async createSalonAssociation(
    freelancerId: string,
    input: Parameters<typeof freelancerRepository.createSalonAssociation>[1],
  ) {
    return freelancerRepository.createSalonAssociation(freelancerId, input);
  },

  async updateSalonAssociation(
    freelancerId: string,
    associationId: string,
    patch: Record<string, unknown>,
  ): Promise<SalonAssociationRow> {
    const updated = await freelancerRepository.updateSalonAssociation(
      freelancerId,
      associationId,
      patch,
    );
    if (!updated) throw new ResourceNotFoundError('Salon association');
    return updated;
  },

  async deleteSalonAssociation(freelancerId: string, associationId: string): Promise<void> {
    const ok = await freelancerRepository.deleteSalonAssociation(freelancerId, associationId);
    if (!ok) throw new ResourceNotFoundError('Salon association');
  },

  // ── Performance ───────────────────────────────────────────────────────────

  async getPerformance(
    freelancerId: string,
    range: '7d' | '30d' | '90d' | '1y',
  ) {
    const cacheKey = `${freelancerId}|${range}`;
    const cached = performanceCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const { start, end } = rangeBounds(range);
    const value = await freelancerRepository.getPerformanceMetrics(freelancerId, start, end);

    performanceCache.set(cacheKey, { value, expiresAt: Date.now() + PERFORMANCE_TTL_MS });
    return value;
  },

  // ── Preferences ───────────────────────────────────────────────────────────

  async getPreferences(userId: string) {
    const existing = await freelancerRepository.getPreferences(userId);
    if (existing) return existing;
    // First read returns defaults rather than 404 — preferences are role-agnostic
    // and a missing row simply means "user has not customised anything yet".
    return freelancerRepository.upsertPreferences(userId, {});
  },

  async updatePreferences(userId: string, patch: Record<string, unknown>) {
    return freelancerRepository.upsertPreferences(userId, patch);
  },
};
