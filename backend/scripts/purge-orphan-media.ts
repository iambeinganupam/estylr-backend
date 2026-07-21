/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────────
// Purge orphan Cloudinary assets — one-shot maintenance script.
//
// Lists every asset under the `kshuri/` folder, compares against
// `media_items.file_key` in Postgres, and deletes the orphans. Image + video
// resource_types are scanned separately because Cloudinary's Admin API splits
// them.
//
// Usage:
//   # See what would be deleted (no Cloudinary mutations)
//   DATABASE_URL=...  npx tsx scripts/purge-orphan-media.ts --dry-run
//
//   # Actually delete the orphans
//   DATABASE_URL=...  npx tsx scripts/purge-orphan-media.ts
//
// Reads CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET /
// CLOUDINARY_FOLDER from .env. Bails if STORAGE_PROVIDER isn't 'cloudinary'.
// ─────────────────────────────────────────────────────────────────────────────

import { v2 as cloudinary } from 'cloudinary';
import { env } from '../src/config/env';
import { query, closeDatabasePool } from '../src/config/database';

interface CloudinaryResource {
  public_id: string;
  bytes?: number;
  format?: string;
  created_at?: string;
}

const FOLDER = env.CLOUDINARY_FOLDER ?? 'kshuri';
const RESOURCE_TYPES = ['image', 'video'] as const;
const PAGE_SIZE = 500;
const DELETE_BATCH = 100; // Cloudinary's API caps bulk-delete at 100 ids/call

const dryRun = process.argv.includes('--dry-run');

function configure() {
  if (env.STORAGE_PROVIDER !== 'cloudinary') {
    console.error(`Aborting — STORAGE_PROVIDER is "${env.STORAGE_PROVIDER}", expected "cloudinary".`);
    process.exit(1);
  }
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    console.error('Aborting — Cloudinary credentials are not set in env.');
    process.exit(1);
  }
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

async function listAllUnder(resourceType: 'image' | 'video'): Promise<CloudinaryResource[]> {
  const all: CloudinaryResource[] = [];
  let nextCursor: string | undefined = undefined;
  do {
    const res = (await cloudinary.api.resources({
      type: 'upload',
      resource_type: resourceType,
      prefix: `${FOLDER}/`,
      max_results: PAGE_SIZE,
      next_cursor: nextCursor,
    })) as { resources: CloudinaryResource[]; next_cursor?: string };
    all.push(...res.resources);
    nextCursor = res.next_cursor;
  } while (nextCursor);
  return all;
}

async function loadKnownKeys(): Promise<Set<string>> {
  const result = await query<{ file_key: string }>('SELECT file_key FROM public.media_items');
  return new Set(result.rows.map((r) => r.file_key));
}

async function deleteInBatches(
  ids: string[],
  resourceType: 'image' | 'video',
): Promise<{ deleted: number; failed: Array<{ id: string; error: string }> }> {
  let deleted = 0;
  const failed: Array<{ id: string; error: string }> = [];
  for (let i = 0; i < ids.length; i += DELETE_BATCH) {
    const slice = ids.slice(i, i + DELETE_BATCH);
    try {
      const res = (await cloudinary.api.delete_resources(slice, {
        resource_type: resourceType,
      })) as { deleted: Record<string, string> };
      for (const [id, outcome] of Object.entries(res.deleted)) {
        if (outcome === 'deleted' || outcome === 'not_found') deleted++;
        else failed.push({ id, error: outcome });
      }
    } catch (e) {
      const msg = (e as Error).message;
      for (const id of slice) failed.push({ id, error: msg });
    }
  }
  return { deleted, failed };
}

async function main() {
  configure();

  const mode = dryRun ? 'DRY-RUN' : 'LIVE';
  console.log(`[${mode}] Cleaning Cloudinary folder "${FOLDER}/" against media_items.file_key`);

  const known = await loadKnownKeys();
  console.log(`Known media_items.file_key rows: ${known.size}`);

  let totalScanned = 0;
  let totalOrphan = 0;
  let totalBytes = 0;
  let totalDeleted = 0;
  const totalFailed: Array<{ id: string; error: string }> = [];

  for (const rt of RESOURCE_TYPES) {
    const remote = await listAllUnder(rt);
    totalScanned += remote.length;
    if (remote.length === 0) continue;

    const orphans = remote.filter((r) => !known.has(r.public_id));
    totalOrphan += orphans.length;
    const orphanBytes = orphans.reduce((sum, r) => sum + (r.bytes ?? 0), 0);
    totalBytes += orphanBytes;

    console.log(
      `  ${rt}: scanned ${remote.length}, orphan ${orphans.length} (${(orphanBytes / 1024 / 1024).toFixed(2)} MB)`,
    );
    for (const o of orphans.slice(0, 10)) {
      console.log(`     · ${o.public_id}  (${o.bytes ?? '?'} B, ${o.format ?? '?'}, ${o.created_at ?? '?'})`);
    }
    if (orphans.length > 10) console.log(`     · …and ${orphans.length - 10} more`);

    if (!dryRun && orphans.length > 0) {
      const { deleted, failed } = await deleteInBatches(orphans.map((o) => o.public_id), rt);
      totalDeleted += deleted;
      totalFailed.push(...failed);
      console.log(`  ${rt}: deleted ${deleted}, failed ${failed.length}`);
    }
  }

  console.log('');
  console.log(`Summary — scanned: ${totalScanned}, orphans: ${totalOrphan}, recoverable: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
  if (!dryRun) console.log(`Deleted: ${totalDeleted}, failed: ${totalFailed.length}`);
  if (totalFailed.length > 0) {
    console.log('Failures:');
    for (const f of totalFailed) console.log(`  · ${f.id}  →  ${f.error}`);
  }

  await closeDatabasePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
