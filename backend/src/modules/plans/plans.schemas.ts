// Schemas live in @kshuri/contracts now — see packages/contracts/src/plans.ts.
// This shim keeps existing intra-backend imports working.
export { planCodeSchema, subscribeToPlanSchema } from '@kshuri/contracts/plans';
export type { SubscribeToPlanInput } from '@kshuri/contracts/plans';
