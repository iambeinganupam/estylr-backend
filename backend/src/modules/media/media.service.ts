// ─────────────────────────────────────────────────────────────────────────────
// Media Module — Service
// ─────────────────────────────────────────────────────────────────────────────

import { mediaRepository } from './media.repository';
import { getStorageProvider } from '../../adapters';
import { ResourceNotFoundError, ConflictError } from '../../lib/errors';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

const MEDIA_BUCKET = 'media';
const MAX_MEDIA_PER_SERVICE = 3;

interface MediaRow {
  id: string;
  file_url: string;
  mime_type: string;
  file_size: number;
  title?: string | null;
  file_key?: string | null;
  caption?: string | null;
  is_featured?: boolean;
  created_at: string;
  service_id?: string | null;
  svc_id?: string | null;
  svc_name?: string | null;
  svc_category_id?: string | null;
  svc_category_name?: string | null;
  svc_category_text?: string | null;
}

function toApiShape(raw: unknown) {
  const row = raw as MediaRow;
  return {
    id: row.id,
    url: row.file_url,
    mime_type: row.mime_type,
    size_bytes: row.file_size,
    original_filename: row.title ?? path.basename(row.file_key ?? ''),
    caption: row.caption ?? null,
    is_featured: row.is_featured,
    created_at: row.created_at,
    service_id: row.service_id ?? null,
    service: row.svc_id
      ? {
          id: row.svc_id,
          name: row.svc_name,
          category_id: row.svc_category_id ?? null,
          // Prefer the FK-resolved name; fall back to the legacy free-text category
          category_name: row.svc_category_name ?? row.svc_category_text ?? null,
        }
      : null,
  };
}

async function assertServiceCapacity(
  vendorType: string,
  vendorId: string,
  serviceId: string,
) {
  const count = await mediaRepository.countByService(vendorType, vendorId, serviceId);
  if (count >= MAX_MEDIA_PER_SERVICE) {
    throw new ConflictError(
      `This service already has ${MAX_MEDIA_PER_SERVICE} photos. Remove one before adding another.`,
    );
  }
}

export const mediaService = {
  async upload(
    vendorType: string, vendorId: string, userId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    meta: {
      title?: string; description?: string; caption?: string;
      mediaType: string; isPublic: boolean; isFeatured: boolean;
      serviceId?: string;
    },
  ) {
    if (meta.serviceId) {
      await assertServiceCapacity(vendorType, vendorId, meta.serviceId);
    }

    const storage = getStorageProvider();
    const ext = path.extname(file.originalname) || '.bin';
    const key = `${vendorType}/${vendorId}/${uuidv4()}${ext}`;

    const uploaded = await storage.upload({
      bucket: MEDIA_BUCKET, key, buffer: file.buffer, mimeType: file.mimetype,
    });

    const row = await mediaRepository.create({
      vendorType, vendorId, fileUrl: uploaded.url, fileKey: uploaded.key,
      mimeType: file.mimetype, fileSize: file.size,
      title: meta.title, description: meta.description, caption: meta.caption,
      mediaType: meta.mediaType, isPublic: meta.isPublic, isFeatured: meta.isFeatured,
      uploadedBy: userId, serviceId: meta.serviceId ?? null,
    });
    return toApiShape(row);
  },

  async listGallery(
    vendorType: string,
    vendorId: string,
    filters: { categoryId?: string; serviceId?: string } = {},
  ) {
    const rows = await mediaRepository.listByVendor(vendorType, vendorId, filters);
    return rows.map(toApiShape);
  },

  async updateMedia(mediaId: string, vendorType: string, vendorId: string, data: {
    caption?: string; is_featured?: boolean; sort_order?: number; is_public?: boolean;
    service_id?: string | null;
  }) {
    const existing = await mediaRepository.findById(mediaId, vendorType, vendorId);
    if (!existing) throw new ResourceNotFoundError('Media item');

    // Re-link to a different service: enforce the cap on the destination
    if (
      data.service_id !== undefined
      && data.service_id !== null
      && data.service_id !== (existing as { service_id?: string | null }).service_id
    ) {
      await assertServiceCapacity(vendorType, vendorId, data.service_id);
    }

    const row = await mediaRepository.update(mediaId, vendorType, vendorId, {
      caption: data.caption, isFeatured: data.is_featured,
      sortOrder: data.sort_order, isPublic: data.is_public,
      serviceId: data.service_id,
    });
    return toApiShape(row);
  },

  async deleteMedia(mediaId: string, vendorType: string, vendorId: string) {
    const media = await mediaRepository.findById(mediaId, vendorType, vendorId);
    if (!media) throw new ResourceNotFoundError('Media item');

    const storage = getStorageProvider();
    await storage.delete({ bucket: MEDIA_BUCKET, key: (media as { file_key: string }).file_key });
    await mediaRepository.delete(mediaId);
  },
};
