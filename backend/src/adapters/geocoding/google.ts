// ─────────────────────────────────────────────────────────────────────────────
// Google Geocoding API adapter (GEOCODING_PROVIDER=google)
// ─────────────────────────────────────────────────────────────────────────────
// Forward + reverse geocoding via the Maps Geocoding REST API. Requires
// GOOGLE_GEOCODING_API_KEY. Network calls are bounded by withTimeout().
// ─────────────────────────────────────────────────────────────────────────────

import type { IGeocoder, GeocodeResult, AddressComponents } from './index';
import { env } from '../../config/env';
import { ExternalServiceError } from '../../lib/errors';
import { withTimeout } from '../../lib/with-adapter-timeout';

const BASE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

interface GoogleAddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

interface GoogleResult {
  formatted_address: string;
  geometry: { location: { lat: number; lng: number } };
  address_components: GoogleAddressComponent[];
}

interface GoogleResponse {
  status: string;
  results: GoogleResult[];
  error_message?: string;
}

/** Pull the first component whose `types` includes the requested type. */
function pick(components: GoogleAddressComponent[], type: string): string | undefined {
  return components.find((c) => c.types.includes(type))?.long_name;
}

function mapComponents(r: GoogleResult): AddressComponents {
  const c = r.address_components;
  const streetNumber = pick(c, 'street_number');
  const route = pick(c, 'route');
  const line1 = [streetNumber, route].filter(Boolean).join(' ')
    || pick(c, 'sublocality')
    || pick(c, 'neighborhood')
    || '';
  const countryShort = c.find((x) => x.types.includes('country'))?.short_name;
  return {
    address_line1: line1,
    city:          pick(c, 'locality') || pick(c, 'administrative_area_level_2'),
    state:         pick(c, 'administrative_area_level_1'),
    postal_code:   pick(c, 'postal_code'),
    country_code:  countryShort ? countryShort.toUpperCase() : undefined,
  };
}

export class GoogleGeocoder implements IGeocoder {
  private apiKey: string;

  constructor() {
    if (!env.GOOGLE_GEOCODING_API_KEY) {
      throw new ExternalServiceError({
        service: 'google-geocoding',
        message: 'GOOGLE_GEOCODING_API_KEY is required when GEOCODING_PROVIDER=google',
      });
    }
    this.apiKey = env.GOOGLE_GEOCODING_API_KEY;
  }

  private async call(params: Record<string, string>): Promise<GoogleResponse> {
    const qs = new URLSearchParams({ ...params, key: this.apiKey }).toString();
    return withTimeout('geocoding/google', async (signal) => {
      const res = await fetch(`${BASE_URL}?${qs}`, { signal });
      if (!res.ok) {
        throw new ExternalServiceError({ service: 'google-geocoding', message: `HTTP ${res.status}` });
      }
      const body = (await res.json()) as GoogleResponse;
      // Google returns 200 with a status field; OK / ZERO_RESULTS are non-errors.
      if (body.status !== 'OK' && body.status !== 'ZERO_RESULTS') {
        throw new ExternalServiceError({
          service: 'google-geocoding',
          message: body.error_message || `Geocoding failed: ${body.status}`,
          status: body.status,
        });
      }
      return body;
    });
  }

  async forward(text: string, countryHint = 'in'): Promise<GeocodeResult[]> {
    const body = await this.call({
      address: text,
      components: `country:${countryHint.toUpperCase()}`,
    });
    return body.results.map((r) => ({
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      display_name: r.formatted_address,
      components: mapComponents(r),
    }));
  }

  async reverse(lat: number, lng: number): Promise<AddressComponents | null> {
    const body = await this.call({ latlng: `${lat},${lng}` });
    const first = body.results[0];
    return first ? mapComponents(first) : null;
  }
}
