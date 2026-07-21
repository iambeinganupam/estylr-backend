// Schemas live in @kshuri/contracts now — see packages/contracts/src/entitlements.ts.
// This shim keeps existing intra-backend imports working.
export {
  createFeatureSchema,
  updateFeatureSchema,
  featureCodeParam,
  planCodeParam,
  featureAndPlanParams,
  overrideIdParam,
  setPlanEntitlementSchema,
  createOverrideSchema,
  listFeaturesQuerySchema,
} from '@kshuri/contracts/entitlements';
