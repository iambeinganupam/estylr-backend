import type { IGeocoder, GeocodeResult, AddressComponents } from './index';

export class ConsoleGeocoder implements IGeocoder {
  async forward(_text: string): Promise<GeocodeResult[]> { return []; }
  async reverse(_lat: number, _lng: number): Promise<AddressComponents | null> { return null; }
}
