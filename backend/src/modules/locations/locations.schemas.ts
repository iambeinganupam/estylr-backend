// Schemas live in @kshuri/contracts now — see packages/contracts/src/locations.ts.
// This shim keeps existing intra-backend imports working.
export { citiesQuerySchema } from '@kshuri/contracts/locations';
export type { CitiesQuery } from '@kshuri/contracts/locations';
