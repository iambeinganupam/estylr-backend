// Schemas live in @kshuri/contracts now — see packages/contracts/src/devices.ts.
// This shim keeps existing intra-backend imports working.
export {
  registerDeviceSchema,
  unregisterDeviceSchema,
} from '@kshuri/contracts/devices';

export type {
  RegisterDeviceInput,
  UnregisterDeviceInput,
} from '@kshuri/contracts/devices';
