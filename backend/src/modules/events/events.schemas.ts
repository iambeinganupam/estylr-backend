// Schemas live in @kshuri/contracts now — see packages/contracts/src/events.ts.
// This shim keeps existing intra-backend imports working.
export {
  createEventSchema,
  updateEventSchema,
  addAttendeeSchema,
  updateAttendeeSchema,
  checkoutEventSchema,
  eventIdParam,
  attendeeIdParam,
} from '@kshuri/contracts/events';
