// ─────────────────────────────────────────────────────────────────────────────
// File Storage — Strategy Pattern Interface
// ─────────────────────────────────────────────────────────────────────────────
// Plug-and-play: switch providers via STORAGE_PROVIDER env var.
// Local → Cloudinary (free) → S3 / Supabase (production)
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs/promises';
import path from 'path';
import { v2 as cloudinary } from 'cloudinary';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../../config/env';
import { withTimeout } from '../../lib/with-adapter-timeout';

export interface UploadedFile {
  key: string;         // storage key / file path
  url: string;         // public-accessible URL
  size: number;
  mime_type: string;
}

export interface StorageProvider {
  /**
   * Upload a file to storage.
   */
  upload(params: {
    bucket: string;
    key: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<UploadedFile>;

  /**
   * Delete a file from storage.
   */
  delete(params: { bucket: string; key: string }): Promise<void>;

  /**
   * Get the public URL of a stored file.
   */
  getPublicUrl(params: { bucket: string; key: string }): string;
}

/**
 * Local File Storage — Saves to disk (development only).
 */
export class LocalStorageProvider implements StorageProvider {
  private basePath: string;

  constructor() {
    this.basePath = path.resolve(env.STORAGE_LOCAL_PATH);
  }

  async upload(params: {
    bucket: string;
    key: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<UploadedFile> {
    const dirPath = path.join(this.basePath, params.bucket);
    await fs.mkdir(dirPath, { recursive: true });

    const filePath = path.join(dirPath, params.key);
    await fs.writeFile(filePath, params.buffer);

    return {
      key: params.key,
      url: this.getPublicUrl({ bucket: params.bucket, key: params.key }),
      size: params.buffer.length,
      mime_type: params.mimeType,
    };
  }

  async delete(params: { bucket: string; key: string }): Promise<void> {
    const filePath = path.join(this.basePath, params.bucket, params.key);
    try {
      await fs.unlink(filePath);
    } catch {
      // File may not exist — that's fine
    }
  }

  getPublicUrl(params: { bucket: string; key: string }): string {
    return `/uploads/${params.bucket}/${params.key}`;
  }
}

/**
 * Cloudinary Storage — free tier, production-ready CDN.
 * Switch to this by setting STORAGE_PROVIDER=cloudinary.
 * Switching to S3/Supabase later: only change adapters/index.ts.
 */
export class CloudinaryStorageProvider implements StorageProvider {
  private folder: string;

  constructor() {
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME!,
      api_key: env.CLOUDINARY_API_KEY!,
      api_secret: env.CLOUDINARY_API_SECRET!,
      secure: true,
      // SDK-level timeout (ms) — Cloudinary's HTTP client aborts the socket
      // even when our caller-side withTimeout race fires. Set 10s to match
      // the wrapper's default; if the wrapper's race wins first, this still
      // closes the socket in the background so the resource isn't leaked.
      timeout: 10_000,
    });
    this.folder = env.CLOUDINARY_FOLDER ?? 'kshuri';
  }

  async upload(params: {
    bucket: string;
    key: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<UploadedFile> {
    // public_id = folder/bucket/key (without extension — Cloudinary handles that)
    const publicId = `${this.folder}/${params.bucket}/${params.key.replace(/\.[^.]+$/, '')}`;
    const resourceType = params.mimeType.startsWith('video/') ? 'video' : 'image';

    type CloudinaryResult = { secure_url: string; public_id: string; bytes: number };
    const result = await withTimeout('storage/cloudinary', async () => {
      return new Promise<CloudinaryResult>((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { public_id: publicId, resource_type: resourceType, overwrite: true },
          (err, result) => {
            if (err || !result) return reject(err ?? new Error('Cloudinary upload failed'));
            resolve(result as unknown as CloudinaryResult);
          },
        ).end(params.buffer);
      });
    });

    return {
      key: result.public_id,
      url: result.secure_url,
      size: result.bytes,
      mime_type: params.mimeType,
    };
  }

  async delete(params: { bucket: string; key: string }): Promise<void> {
    // key stored in DB is already the Cloudinary public_id
    try {
      await withTimeout('storage/cloudinary', async () => {
        await cloudinary.uploader.destroy(params.key);
      });
    } catch {
      // Non-fatal — file may have already been deleted on Cloudinary
    }
  }

  getPublicUrl(params: { bucket: string; key: string }): string {
    return cloudinary.url(params.key, { secure: true });
  }
}

/**
 * AWS S3 Storage — production object storage (STORAGE_PROVIDER=s3).
 *
 * One physical S3 bucket (env.AWS_S3_BUCKET) holds everything; the logical
 * `bucket` param becomes a key prefix, so the returned `key` is the full S3
 * object key. `delete`/`getPublicUrl` then operate on that stored key directly
 * — mirroring the CloudinaryStorageProvider's public_id semantics so the two
 * are drop-in interchangeable from the media service's perspective.
 *
 * Credentials come from the AWS default provider chain (env keys or an IAM
 * role). No ACL is set on upload — modern buckets enforce Object Ownership and
 * serve public reads via a bucket policy or a CloudFront distribution fronted
 * by AWS_S3_PUBLIC_BASE_URL.
 */
export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucketName: string;
  private region: string;
  private publicBaseUrl?: string;

  constructor() {
    this.bucketName = env.AWS_S3_BUCKET!;
    this.region = env.AWS_S3_REGION!;
    this.publicBaseUrl = env.AWS_S3_PUBLIC_BASE_URL?.replace(/\/$/, '');
    this.client = new S3Client({ region: this.region });
  }

  async upload(params: {
    bucket: string;
    key: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<UploadedFile> {
    const objectKey = `${params.bucket}/${params.key}`;

    await withTimeout('storage/s3', async (signal) => {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: objectKey,
          Body: params.buffer,
          ContentType: params.mimeType,
        }),
        { abortSignal: signal },
      );
    });

    return {
      key: objectKey,
      url: this.getPublicUrl({ bucket: params.bucket, key: objectKey }),
      size: params.buffer.length,
      mime_type: params.mimeType,
    };
  }

  async delete(params: { bucket: string; key: string }): Promise<void> {
    try {
      await withTimeout('storage/s3', async (signal) => {
        await this.client.send(
          new DeleteObjectCommand({ Bucket: this.bucketName, Key: params.key }),
          { abortSignal: signal },
        );
      });
    } catch {
      // Non-fatal — object may already be gone.
    }
  }

  getPublicUrl(params: { bucket: string; key: string }): string {
    // `key` MUST be the FULL S3 object key (already includes the logical-bucket
    // prefix, as returned by upload); `bucket` is intentionally unused here —
    // mirroring Cloudinary's public_id semantics, unlike LocalStorageProvider.
    // Honor a CDN base if set.
    if (this.publicBaseUrl) return `${this.publicBaseUrl}/${params.key}`;
    return `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${params.key}`;
  }
}

// export class SupabaseStorageProvider implements StorageProvider { ... }
