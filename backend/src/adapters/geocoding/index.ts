import { env } from '../../config/env';

export interface AddressComponents {
  address_line1: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country_code?: string;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  components: AddressComponents;
  display_name: string;
}

export interface IGeocoder {
  forward(text: string, countryHint?: string): Promise<GeocodeResult[]>;
  reverse(lat: number, lng: number): Promise<AddressComponents | null>;
}

import { ConsoleGeocoder } from './console';
import { GoogleGeocoder } from './google';
import { NominatimGeocoder } from './nominatim';

let cached: IGeocoder | null = null;

export function getGeocoder(): IGeocoder {
  if (cached) return cached;
  switch (env.GEOCODING_PROVIDER) {
    case 'console':   cached = new ConsoleGeocoder(); break;
    case 'google':    cached = new GoogleGeocoder();   break;
    case 'nominatim':
    default:          cached = new NominatimGeocoder(); break;
  }
  return cached!;
}

export function __resetGeocoder() { cached = null; }
