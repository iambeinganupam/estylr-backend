// ─────────────────────────────────────────────────────────────────────────────
// Devices Module — Controller
// ─────────────────────────────────────────────────────────────────────────────
// Push-notification device registry. Mobile apps call POST /devices/register
// once on auth (after permission grant) to deposit their Expo push token.
// They call DELETE /devices/register on logout.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { created, noContent } from '../../lib/response';
import * as devicesService from './devices.service';
import { registerDeviceSchema, unregisterDeviceSchema } from './devices.schemas';

export const devicesController = Router();

devicesController.post(
  '/register',
  authMiddleware,
  validateBody(registerDeviceSchema),
  asyncHandler(async (req, res) => {
    const device = await devicesService.registerDevice({
      userId: req.auth!.userId,
      expoPushToken: req.body.expo_push_token,
      audience: req.body.audience,
      platform: req.body.platform,
      deviceName: req.body.device_name,
      appVersion: req.body.app_version,
    });
    created(res, {
      id: device.id,
      audience: device.audience,
      platform: device.platform,
      registered_at: device.created_at,
    });
  }),
);

devicesController.delete(
  '/register',
  authMiddleware,
  validateBody(unregisterDeviceSchema),
  asyncHandler(async (req, res) => {
    await devicesService.unregisterDevice(
      req.auth!.userId,
      req.body.expo_push_token,
    );
    noContent(res);
  }),
);
