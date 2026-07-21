// ─────────────────────────────────────────────────────────────────────────────
// Addresses Module — Repository (raw SQL on user_addresses)
// ─────────────────────────────────────────────────────────────────────────────
import { query, queryOne, withTransaction } from '../../config/database';

export interface AddressRow {
  id: string;
  user_id: string;
  label: string;
  recipient_name: string | null;
  contact_phone: string | null;
  address_line1: string;
  address_line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  postal_code: string | null;
  country_code: string;
  latitude: number | null;
  longitude: number | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

const SELECT_FIELDS = `
  id, user_id, label, recipient_name, contact_phone,
  address_line1, address_line2, landmark, city, state, postal_code, country_code,
  ST_Y(coordinates::geometry) AS latitude,
  ST_X(coordinates::geometry) AS longitude,
  is_default, created_at, updated_at
`;

export async function list(userId: string): Promise<AddressRow[]> {
  const res = await query<AddressRow>(
    `SELECT ${SELECT_FIELDS} FROM public.user_addresses
       WHERE user_id = $1
       ORDER BY is_default DESC, updated_at DESC`,
    [userId],
  );
  return res.rows;
}

export async function findById(userId: string, id: string): Promise<AddressRow | null> {
  return queryOne<AddressRow>(
    `SELECT ${SELECT_FIELDS} FROM public.user_addresses WHERE user_id = $1 AND id = $2`,
    [userId, id],
  );
}

export interface InsertArgs {
  userId: string;
  label: string;
  recipientName?: string;
  contactPhone?: string;
  addressLine1: string;
  addressLine2?: string;
  landmark?: string;
  city: string;
  state: string;
  postalCode?: string;
  countryCode: string;
  latitude?: number;
  longitude?: number;
  isDefault: boolean;
}

export async function insert(args: InsertArgs): Promise<AddressRow> {
  return withTransaction(async (client) => {
    // If first address, force default.
    const countRes = await client.query<{ n: string }>(
      'SELECT COUNT(*)::text AS n FROM public.user_addresses WHERE user_id = $1',
      [args.userId],
    );
    const isFirst = countRes.rows[0]?.n === '0';
    const isDefault = isFirst || args.isDefault;

    if (isDefault) {
      await client.query(
        'UPDATE public.user_addresses SET is_default = FALSE WHERE user_id = $1 AND is_default = TRUE',
        [args.userId],
      );
    }

    const coordsSet = args.latitude !== undefined && args.longitude !== undefined
      ? `ST_SetSRID(ST_MakePoint($13, $14), 4326)`
      : `NULL`;
    const params: unknown[] = [
      args.userId, args.label, args.recipientName ?? null, args.contactPhone ?? null,
      args.addressLine1, args.addressLine2 ?? null, args.landmark ?? null,
      args.city, args.state, args.postalCode ?? null, args.countryCode,
      isDefault,
    ];
    if (args.latitude !== undefined) params.push(args.longitude, args.latitude);

    const insertRes = await client.query<AddressRow>(
      `INSERT INTO public.user_addresses
         (user_id, label, recipient_name, contact_phone,
          address_line1, address_line2, landmark, city, state, postal_code, country_code,
          is_default, coordinates)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, ${coordsSet})
       RETURNING ${SELECT_FIELDS}`,
      params,
    );
    return insertRes.rows[0] as AddressRow;
  });
}

export interface UpdateArgs extends Partial<InsertArgs> { id: string; userId: string; }

export async function update(args: UpdateArgs): Promise<AddressRow | null> {
  return withTransaction(async (client) => {
    const owner = await client.query(
      'SELECT 1 FROM public.user_addresses WHERE id=$1 AND user_id=$2',
      [args.id, args.userId],
    );
    if (owner.rowCount === 0) return null;

    if (args.isDefault === true) {
      await client.query(
        'UPDATE public.user_addresses SET is_default = FALSE WHERE user_id = $1 AND is_default = TRUE AND id <> $2',
        [args.userId, args.id],
      );
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    if (args.label          !== undefined) push('label', args.label);
    if (args.recipientName  !== undefined) push('recipient_name', args.recipientName);
    if (args.contactPhone   !== undefined) push('contact_phone', args.contactPhone);
    if (args.addressLine1   !== undefined) push('address_line1', args.addressLine1);
    if (args.addressLine2   !== undefined) push('address_line2', args.addressLine2);
    if (args.landmark       !== undefined) push('landmark', args.landmark);
    if (args.city           !== undefined) push('city', args.city);
    if (args.state          !== undefined) push('state', args.state);
    if (args.postalCode     !== undefined) push('postal_code', args.postalCode);
    if (args.countryCode    !== undefined) push('country_code', args.countryCode);
    if (args.isDefault      !== undefined) push('is_default', args.isDefault);

    if (args.latitude !== undefined && args.longitude !== undefined) {
      params.push(args.longitude, args.latitude);
      sets.push(`coordinates = ST_SetSRID(ST_MakePoint($${params.length - 1}, $${params.length}), 4326)`);
    }

    if (sets.length === 0) {
      const cur = await client.query<AddressRow>(
        `SELECT ${SELECT_FIELDS} FROM public.user_addresses WHERE id=$1`,
        [args.id],
      );
      return cur.rows[0] ?? null;
    }

    params.push(args.id);
    const res = await client.query<AddressRow>(
      `UPDATE public.user_addresses SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING ${SELECT_FIELDS}`,
      params,
    );
    return res.rows[0] ?? null;
  });
}

export async function remove(userId: string, id: string): Promise<boolean> {
  return withTransaction(async (client) => {
    const target = await client.query<{ is_default: boolean }>(
      'DELETE FROM public.user_addresses WHERE user_id=$1 AND id=$2 RETURNING is_default',
      [userId, id],
    );
    if (target.rowCount === 0) return false;
    if (target.rows[0]?.is_default) {
      // Promote next most-recently-updated to default.
      await client.query(
        `UPDATE public.user_addresses SET is_default = TRUE
           WHERE id = (
             SELECT id FROM public.user_addresses WHERE user_id = $1
             ORDER BY updated_at DESC LIMIT 1
           )`,
        [userId],
      );
    }
    return true;
  });
}

export async function setDefault(userId: string, id: string): Promise<AddressRow | null> {
  return withTransaction(async (client) => {
    const target = await client.query(
      'SELECT 1 FROM public.user_addresses WHERE id=$1 AND user_id=$2',
      [id, userId],
    );
    if (target.rowCount === 0) return null;
    await client.query(
      'UPDATE public.user_addresses SET is_default = (id = $1) WHERE user_id = $2',
      [id, userId],
    );
    const res = await client.query<AddressRow>(
      `SELECT ${SELECT_FIELDS} FROM public.user_addresses WHERE id=$1`,
      [id],
    );
    return res.rows[0] ?? null;
  });
}

export async function getDefaultForUser(userId: string): Promise<AddressRow | null> {
  return queryOne<AddressRow>(
    `SELECT ${SELECT_FIELDS} FROM public.user_addresses WHERE user_id=$1 AND is_default=TRUE`,
    [userId],
  );
}
