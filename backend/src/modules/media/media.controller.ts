// ─────────────────────────────────────────────────────────────────────────────
// Media Module — Controller (MEDIA-01 through MEDIA-04)
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { tenantMiddleware } from '../../middleware/tenant.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import { success, created, noContent } from '../../lib/response';
import { mediaService } from './media.service';
import { mediaUploadSchema, mediaUpdateSchema, mediaListQuerySchema, mediaIdParam } from './media.schemas';
import { VENDOR_TYPE } from '../../lib/constants';
import { ValidationError } from '../../lib/errors';
import multer from 'multer';
import FileType from 'file-type';

export const mediaController = Router();
mediaController.use(authMiddleware);
mediaController.use(roleGuard('freelancer', 'business_admin', 'staff'));
mediaController.use(tenantMiddleware);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Unsupported: ${file.mimetype}. Allowed: ${ALLOWED_MIMES.join(', ')}`));
  },
});

function resolveVendor(req: import('express').Request) {
  if (req.auth!.role === 'freelancer') {
    return { vendorType: VENDOR_TYPE.FREELANCER, vendorId: req.tenant!.freelancerProfileId! };
  }
  return { vendorType: VENDOR_TYPE.SALON_LOCATION, vendorId: req.tenant!.locationId || req.tenant!.businessId! };
}

// ── MEDIA-01: List Portfolio Media ──
mediaController.get(
  '/portfolio',
  validateQuery(mediaListQuerySchema),
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = resolveVendor(req);
    const items = await mediaService.listGallery(vendorType, vendorId, {
      categoryId: req.query.category_id as string | undefined,
      serviceId: req.query.service_id as string | undefined,
    });
    success(res, items);
  }),
);

// ── MEDIA-02: Upload Media ──
mediaController.post(
  '/portfolio',
  upload.single('file'),
  validateBody(mediaUploadSchema),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError({ field: 'file', message: 'File is required.' });
    }
    const detected = await FileType.fromBuffer(req.file.buffer);
    const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!detected || !ALLOWED_IMAGE_MIMES.includes(detected.mime)) {
      throw new ValidationError({ field: 'file', message: 'Unsupported or spoofed file type. Only JPEG, PNG, WebP, and GIF images are allowed.' });
    }
    const { vendorType, vendorId } = resolveVendor(req);

    // Identity-document uploads share this endpoint with portfolio media for
    // now. Force the security-relevant flags server-side so a stale client
    // can't accidentally classify a KYC doc as a public portfolio image.
    const isKyc = req.body.purpose === 'kyc' || req.body.media_type === 'kyc';
    const mediaType  = isKyc ? 'kyc'  : req.body.media_type;
    const isPublic   = isKyc ? false  : req.body.is_public;
    const isFeatured = isKyc ? false  : req.body.is_featured;

    const media = await mediaService.upload(vendorType, vendorId, req.auth!.userId, req.file, {
      title: req.body.title, description: req.body.description, caption: req.body.caption,
      mediaType, isPublic, isFeatured,
      serviceId: req.body.service_id,
    });
    created(res, media);
  }),
);

// ── MEDIA-03: Update Media Metadata ──
mediaController.put(
  '/portfolio/:id',
  validateParams(mediaIdParam),
  validateBody(mediaUpdateSchema),
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = resolveVendor(req);
    const media = await mediaService.updateMedia(String(req.params.id), vendorType, vendorId, req.body);
    success(res, media);
  }),
);

// ── MEDIA-04: Delete Media ──
mediaController.delete(
  '/portfolio/:id',
  validateParams(mediaIdParam),
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = resolveVendor(req);
    await mediaService.deleteMedia(String(req.params.id), vendorType, vendorId);
    noContent(res);
  }),
);
