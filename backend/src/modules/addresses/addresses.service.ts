// ─────────────────────────────────────────────────────────────────────────────
// Addresses Module — Service
// ─────────────────────────────────────────────────────────────────────────────
// Business logic: validates ownership, fills coords from geocoder when absent,
// resolves `is_default` semantics. Repository handles transactional defaults.
// ─────────────────────────────────────────────────────────────────────────────
import * as repo from './addresses.repository';
import { AddressNotFoundError, ExternalServiceError } from '../../lib/errors';
import { getGeocoder } from '../../adapters/geocoding';
import type { CreateAddressInput, UpdateAddressInput } from './addresses.schemas';
import { logger } from '../../config/logger';

async function maybeGeocode(
  patch: {
    address_line1?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country_code?: string;
    latitude?: number;
    longitude?: number;
  },
): Promise<{ latitude?: number; longitude?: number }> {
  if (patch.latitude !== undefined && patch.longitude !== undefined) return {};
  if (!patch.address_line1 || !patch.city) return {};
  try {
    const text = [patch.address_line1, patch.city, patch.state, patch.postal_code]
      .filter(Boolean)
      .join(', ');
    const results = await getGeocoder().forward(text, patch.country_code?.toLowerCase());
    if (results.length === 0) return {};
    return { latitude: results[0]!.lat, longitude: results[0]!.lng };
  } catch (err) {
    logger.warn({ err }, 'address geocoding failed; persisting without coords');
    return {};
  }
}

export async function list(userId: string) {
  return repo.list(userId);
}

export async function getOne(userId: string, id: string) {
  const row = await repo.findById(userId, id);
  if (!row) throw new AddressNotFoundError(id);
  return row;
}

export async function create(userId: string, input: CreateAddressInput) {
  const filled = await maybeGeocode(input);
  return repo.insert({
    userId,
    label: input.label,
    recipientName: input.recipient_name,
    contactPhone: input.contact_phone,
    addressLine1: input.address_line1,
    addressLine2: input.address_line2,
    landmark: input.landmark,
    city: input.city,
    state: input.state,
    postalCode: input.postal_code,
    countryCode: input.country_code,
    latitude: input.latitude ?? filled.latitude,
    longitude: input.longitude ?? filled.longitude,
    isDefault: input.is_default,
  });
}

export async function update(userId: string, id: string, input: UpdateAddressInput) {
  const filled = await maybeGeocode(input);
  const out = await repo.update({
    id,
    userId,
    label: input.label,
    recipientName: input.recipient_name,
    contactPhone: input.contact_phone,
    addressLine1: input.address_line1,
    addressLine2: input.address_line2,
    landmark: input.landmark,
    city: input.city,
    state: input.state,
    postalCode: input.postal_code,
    countryCode: input.country_code,
    latitude: input.latitude ?? filled.latitude,
    longitude: input.longitude ?? filled.longitude,
    isDefault: input.is_default,
  });
  if (!out) throw new AddressNotFoundError(id);
  return out;
}

export async function remove(userId: string, id: string) {
  const ok = await repo.remove(userId, id);
  if (!ok) throw new AddressNotFoundError(id);
}

export async function setDefault(userId: string, id: string) {
  const out = await repo.setDefault(userId, id);
  if (!out) throw new AddressNotFoundError(id);
  return out;
}

export async function geocodeForward(text: string, countryHint?: string) {
  try {
    return await getGeocoder().forward(text, countryHint);
  } catch (err) {
    if (err instanceof ExternalServiceError) throw err;
    throw new ExternalServiceError({ service: 'geocoding', message: (err as Error).message });
  }
}

export async function geocodeReverse(lat: number, lng: number) {
  try {
    return await getGeocoder().reverse(lat, lng);
  } catch (err) {
    if (err instanceof ExternalServiceError) throw err;
    throw new ExternalServiceError({ service: 'geocoding', message: (err as Error).message });
  }
}
