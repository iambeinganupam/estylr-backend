import type { IGeocoder, GeocodeResult, AddressComponents } from './index';
import { env } from '../../config/env';
import { ExternalServiceError } from '../../lib/errors';

const BASE_URL = 'https://nominatim.openstreetmap.org';
const MIN_GAP_MS = 1000;

function mapComponents(addr: Record<string, string> | undefined): AddressComponents {
  return {
    address_line1: addr?.road || addr?.suburb || addr?.neighbourhood || addr?.hamlet || '',
    city:          addr?.city || addr?.town || addr?.village || addr?.county,
    state:         addr?.state,
    postal_code:   addr?.postcode,
    country_code:  addr?.country_code ? addr.country_code.toUpperCase() : undefined,
  };
}

export class NominatimGeocoder implements IGeocoder {
  private nextSlot = 0;

  private headers: Record<string, string> = {
    'User-Agent': env.NOMINATIM_USER_AGENT,
    'Accept': 'application/json',
  };

  private async throttle(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, this.nextSlot - now);
    this.nextSlot = Math.max(now, this.nextSlot) + MIN_GAP_MS;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  async forward(text: string, countryHint = 'in'): Promise<GeocodeResult[]> {
    await this.throttle();
    const url = `${BASE_URL}/search?q=${encodeURIComponent(text)}&format=jsonv2&addressdetails=1&limit=5&countrycodes=${countryHint}`;
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) throw new ExternalServiceError({ service: 'nominatim', message: `forward failed (${res.status})` });
    const arr = (await res.json()) as Array<{ lat: string; lon: string; display_name: string; address?: Record<string, string> }>;
    return arr.map((r) => ({
      lat: Number(r.lat),
      lng: Number(r.lon),
      display_name: r.display_name,
      components: mapComponents(r.address),
    }));
  }

  async reverse(lat: number, lng: number): Promise<AddressComponents | null> {
    await this.throttle();
    const url = `${BASE_URL}/reverse?lat=${lat}&lon=${lng}&format=jsonv2&addressdetails=1`;
    const res = await fetch(url, { headers: this.headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new ExternalServiceError({ service: 'nominatim', message: `reverse failed (${res.status})` });
    const body = (await res.json()) as { address?: Record<string, string> };
    return body.address ? mapComponents(body.address) : null;
  }
}
