// Schemas live in @kshuri/contracts now — see packages/contracts/src/addresses.ts.
// This shim keeps existing intra-backend imports working (controller, service,
// tests) while the migration to the shared contracts package rolls out.
export {
  createAddressSchema,
  updateAddressSchema,
  addressIdParam,
  geocodeForwardSchema,
  geocodeReverseSchema,
} from '@kshuri/contracts/addresses';

export type {
  CreateAddressInput,
  UpdateAddressInput,
  GeocodeForwardInput,
  GeocodeReverseInput,
} from '@kshuri/contracts/addresses';
