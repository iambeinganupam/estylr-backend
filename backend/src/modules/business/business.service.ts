// ─────────────────────────────────────────────────────────────────────────────
// Business Module — Service Layer
// ─────────────────────────────────────────────────────────────────────────────

import { businessRepository } from './business.repository';
import { ResourceNotFoundError, ConflictError } from '../../lib/errors';
import { BUSINESS_ADDRESS_FIELDS } from './business.schemas';
import { staffService } from '../staff/staff.service';

export const businessService = {
  async getProfile(businessAccountId: string) {
    const profile = await businessRepository.getBusinessProfile(businessAccountId);
    if (!profile) throw new ResourceNotFoundError('Business profile');
    return profile;
  },

  // Splits the payload: address fields go to the primary salon_location, everything
  // else updates the business_accounts row. Returns the merged GET-shaped profile so
  // the client cache can replace its snapshot in one shot.
  async updateProfile(businessAccountId: string, data: Record<string, unknown>) {
    const addressKeys = new Set<string>(BUSINESS_ADDRESS_FIELDS);
    const businessFields: Record<string, unknown> = {};
    const addressFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      if (addressKeys.has(k)) addressFields[k] = v;
      else businessFields[k] = v;
    }

    if (Object.keys(addressFields).length > 0) {
      const locId = await businessRepository.getPrimaryLocationId(businessAccountId);
      if (!locId) {
        throw new ConflictError(
          'Set up a salon location before saving an address. Create one in Settings → Locations.',
        );
      }
      await businessRepository.updateLocation(locId, businessAccountId, addressFields);
    }

    if (Object.keys(businessFields).length > 0) {
      await businessRepository.updateBusinessProfile(businessAccountId, businessFields);
    }

    // Always return the freshly-joined profile so callers see address + business fields together.
    return this.getProfile(businessAccountId);
  },

  async getLocation(locationId: string, businessAccountId: string) {
    const location = await businessRepository.getLocation(locationId, businessAccountId);
    if (!location) throw new ResourceNotFoundError('Location');
    return location;
  },

  async updateLocation(locationId: string, businessAccountId: string, data: Record<string, unknown>) {
    // Verify location exists and belongs to this business
    await this.getLocation(locationId, businessAccountId);
    const updated = await businessRepository.updateLocation(locationId, businessAccountId, data);
    if (!updated) return this.getLocation(locationId, businessAccountId);
    return updated;
  },

  async listStaff(businessAccountId: string) {
    return businessRepository.listStaff(businessAccountId);
  },

  async getStaffMember(staffId: string, businessAccountId: string) {
    const member = await businessRepository.getStaffMember(staffId, businessAccountId);
    if (!member) throw new ResourceNotFoundError('Staff member');
    return member;
  },

  async inviteStaff(params: {
    email: string;
    first_name?: string;
    last_name?: string;
    firstName?: string;
    lastName?: string;
    role: string;
    location_id?: string;
    locationId?: string;
    commission_rate?: number;
    commission_percentage?: number;
    commissionRate?: number;
    businessAccountId: string;
  }) {
    await staffService.assertValidRoleCode(params.role);
    // Resolve optional location_id — auto-pick first location for this business
    let locationId = params.locationId ?? params.location_id;
    if (!locationId) {
      const locations = await businessRepository.listLocations(params.businessAccountId);
      if (!locations.length) throw new ConflictError(
        'No salon location found. Create a location before inviting staff.',
      );
      locationId = locations[0]!.id as string;
    }
    const commissionRate = params.commissionRate ?? params.commission_rate ?? params.commission_percentage ?? 40;
    await businessRepository.inviteStaff({
      email: params.email,
      firstName: params.first_name ?? params.firstName ?? 'Staff',
      lastName: params.last_name ?? params.lastName ?? 'Member',
      role: params.role,
      locationId,
      commissionRate,
      businessAccountId: params.businessAccountId,
    });
    return { message: 'Staff member invited successfully' };
  },

  async updateStaff(staffId: string, businessAccountId: string, data: Record<string, unknown>) {
    if (typeof data.role === 'string') await staffService.assertValidRoleCode(data.role);
    const updated = await businessRepository.updateStaff(staffId, businessAccountId, data);
    if (!updated) throw new ResourceNotFoundError('Staff member');
    return updated;
  },

  async getStaffSchedule(staffId: string, businessAccountId: string) {
    await this.getStaffMember(staffId, businessAccountId);
    return businessRepository.getStaffSchedule(staffId, businessAccountId);
  },

  async getStaffAttendance(staffId: string, businessAccountId: string) {
    await this.getStaffMember(staffId, businessAccountId);
    return businessRepository.getStaffAttendance(staffId, businessAccountId);
  },

  async getStaffAppointments(staffId: string, businessAccountId: string) {
    await this.getStaffMember(staffId, businessAccountId);
    return businessRepository.getStaffAppointments(staffId, businessAccountId);
  },

  async getStaffSalary(staffId: string, businessAccountId: string) {
    await this.getStaffMember(staffId, businessAccountId);
    const salary = await businessRepository.getStaffSalary(staffId, businessAccountId);
    if (!salary) return null;
    const commission = Number(salary.commission_this_month);
    return {
      commission_percentage: salary.commission_percentage,
      base_salary: 0,
      completed_this_month: Number(salary.completed_this_month),
      revenue_this_month: Number(salary.revenue_this_month),
      commission_this_month: commission,
      net_pay: commission,
    };
  },

  async getSubscription(businessAccountId: string) {
    const sub = await businessRepository.getSubscription(businessAccountId);
    if (!sub) {
      return { plan: 'free', status: 'active', message: 'No active subscription found.' };
    }
    return sub;
  },

  async listLocations(businessAccountId: string) {
    return businessRepository.listLocations(businessAccountId);
  },

  async getEngagementMetrics(businessAccountId: string) {
    const metrics = await businessRepository.getEngagementMetrics(businessAccountId);
    return metrics ?? {
      primary_location_id: null,
      view_count: 0,
      favorite_count: 0,
      review_count: 0,
      avg_rating: 0,
    };
  },
};
