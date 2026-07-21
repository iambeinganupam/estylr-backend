// ─────────────────────────────────────────────────────────────────────────────
// Addresses Module — Controller
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { validateBody, validateParams } from '../../middleware/validate.middleware';
import { success, created, noContent } from '../../lib/response';
import * as service from './addresses.service';
import {
  createAddressSchema,
  updateAddressSchema,
  addressIdParam,
  geocodeForwardSchema,
  geocodeReverseSchema,
} from './addresses.schemas';

export const addressesController = Router();
addressesController.use(authMiddleware);

addressesController.get(
  '/me/addresses',
  asyncHandler(async (req, res) => {
    success(res, await service.list(req.auth!.userId));
  }),
);

addressesController.get(
  '/me/addresses/:id',
  validateParams(addressIdParam),
  asyncHandler(async (req, res) => {
    success(res, await service.getOne(req.auth!.userId, req.params.id as string));
  }),
);

addressesController.post(
  '/me/addresses',
  validateBody(createAddressSchema),
  asyncHandler(async (req, res) => {
    created(res, await service.create(req.auth!.userId, req.body));
  }),
);

addressesController.patch(
  '/me/addresses/:id',
  validateParams(addressIdParam),
  validateBody(updateAddressSchema),
  asyncHandler(async (req, res) => {
    success(res, await service.update(req.auth!.userId, req.params.id as string, req.body));
  }),
);

addressesController.delete(
  '/me/addresses/:id',
  validateParams(addressIdParam),
  asyncHandler(async (req, res) => {
    await service.remove(req.auth!.userId, req.params.id as string);
    noContent(res);
  }),
);

addressesController.post(
  '/me/addresses/:id/set-default',
  validateParams(addressIdParam),
  asyncHandler(async (req, res) => {
    success(res, await service.setDefault(req.auth!.userId, req.params.id as string));
  }),
);

addressesController.post(
  '/geocode/forward',
  validateBody(geocodeForwardSchema),
  asyncHandler(async (req, res) => {
    success(res, await service.geocodeForward(req.body.text, req.body.country_hint));
  }),
);

addressesController.post(
  '/geocode/reverse',
  validateBody(geocodeReverseSchema),
  asyncHandler(async (req, res) => {
    success(res, await service.geocodeReverse(req.body.lat, req.body.lng));
  }),
);
