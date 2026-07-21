// Schemas live in @kshuri/contracts now — see packages/contracts/src/cms.ts.
// This shim keeps existing intra-backend imports working.
export {
  createPageSchema,
  updatePageSchema,
  contactFormSchema,
  newsletterSchema,
  createPlannerEventSchema,
  toggleTaskSchema,
  pageListSchema,
  pageIdParam,
  slugParam,
  plannerEventIdParam,
  taskIdParam,
  calloutQuerySchema,
  createCalloutSchema,
  updateCalloutSchema,
  calloutIdParam,
  testimonialQuerySchema,
} from '@kshuri/contracts/cms';
