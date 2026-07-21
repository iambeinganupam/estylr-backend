// ─────────────────────────────────────────────────────────────────────────────
// Discovery Module — Service
// ─────────────────────────────────────────────────────────────────────────────

import { discoveryRepository } from './discovery.repository';
import { catalogRepository } from '../catalog/catalog.repository';
import { ResourceNotFoundError } from '../../lib/errors';
import { decodeCursor, encodeCursor } from '../../lib/cursor';

interface CategoryNode {
  id: string;
  name: string;
  slug: string | null;
  icon: string | null;
  icon_url: string | null;
  description: string | null;
  audience: string | null;
  vendor_count: number;
  subcategories: CategoryNode[];
}

export const discoveryService = {
  async search(params: {
    q?: string; vendorType?: string;
    lat?: number; lng?: number; radiusKm: number;
    category?: string; serviceId?: string;
    gender?: string; minRating?: number;
    minPrice?: number; maxPrice?: number;
    availableToday?: boolean;
    sortBy: string; limit: number;
  }) {
    const rows = await discoveryRepository.searchVendors(params);
    const hasMore = rows.length > params.limit;
    return { items: rows.slice(0, params.limit), hasMore };
  },

  // R1 search v2 — geo + facets + cursor + new sorts. Reads from
  // mv_vendor_discovery via discoveryRepository.searchVendorsV2 and emits the
  // camelCase customer-portal DTO. The repo returns up-to-(limit+1) rows so
  // we can detect hasMore and mint a (score, id) cursor without re-querying.
  async searchVendorsV2(args: any) {
    const cur = decodeCursor(args.cursor);
    const rows = await discoveryRepository.searchVendorsV2({
      q: args.q, vendorType: args.vendor_type,
      lat: args.lat, lng: args.lng, radiusKm: args.radius_km, city: args.city,
      category: args.category, serviceId: args.service_id,
      genderTarget: args.gender_target, serviceMode: args.service_mode,
      openNow: args.open_now,
      minRating: args.min_rating, minPrice: args.min_price, maxPrice: args.max_price,
      sortBy: args.sort_by, limit: args.limit, cursor: cur,
    });
    const hasMore = rows.length > args.limit;
    const items = (hasMore ? rows.slice(0, args.limit) : rows).map((r: any) => ({
      id: r.id, slug: r.slug, name: r.name, type: r.type,
      ratingAvg: Number(r.rating_avg ?? 0), ratingCount: r.rating_count ?? 0,
      distanceKm: r.distance_km !== null && r.distance_km !== undefined ? Number(r.distance_km) : null,
      priceMin: r.price_min !== null && r.price_min !== undefined ? Math.round(Number(r.price_min)) : null,
      priceMax: r.price_max !== null && r.price_max !== undefined ? Math.round(Number(r.price_max)) : null,
      photoCount: r.photo_count ?? 0,
      coverImageUrl: r.cover_image_url ?? null,
      logoUrl: r.logo_url ?? null,
      verified: r.verified === true,
      isOpenNow: r.is_open_now === true,
      lat: r.lat !== null ? Number(r.lat) : null,
      lng: r.lng !== null ? Number(r.lng) : null,
      city: r.city,
    }));
    const last = hasMore ? rows[args.limit - 1] : null;
    const scoreField =
      args.sort_by === 'distance'                                ? 'distance_km' :
      args.sort_by === 'rating_desc' || args.sort_by === 'relevance' ? 'rating_avg' :
      args.sort_by === 'price_asc'                               ? 'price_min' :
      args.sort_by === 'price_desc'                              ? 'price_max' :
      /* popularity */                                            'rating_count';
    const nextCursor = hasMore && last
      ? encodeCursor({ score: Number(last[scoreField] ?? 0), id: last.id })
      : null;
    return { items, nextCursor };
  },

  async getCategories(opts?: { audience?: string }): Promise<CategoryNode[]> {
    const rows = await discoveryRepository.getCategories(opts);
    // Build tree from flat list
    const map = new Map<string, CategoryNode>();
    const roots: CategoryNode[] = [];

    for (const row of rows) {
      map.set(row.id, {
        id: row.id,
        name: row.name,
        slug: row.slug ?? null,
        icon: row.icon ?? null,
        icon_url: row.icon_url ?? null,
        description: row.description ?? null,
        audience: row.audience ?? null,
        vendor_count: row.vendor_count ?? 0,
        subcategories: [],
      });
    }
    for (const row of rows) {
      const node = map.get(row.id)!;
      if (row.parent_id && map.has(row.parent_id)) {
        map.get(row.parent_id)!.subcategories.push(node);
      } else if (row.parent_id === null) {
        roots.push(node);
      }
    }
    return roots;
  },

  /** Resolve a root category by slug (with its subs). Throws 404 if missing
   *  or inactive. The subs are filtered to the same audience as the root
   *  via the existing getCategories pipeline. */
  async getCategoryBySlug(slug: string): Promise<CategoryNode> {
    const root = await discoveryRepository.getCategoryRootBySlug(slug);
    if (!root) throw new ResourceNotFoundError('Category');
    // Reuse the tree builder so vendor_count + subs come back consistently.
    const tree = await this.getCategories({ audience: root.audience });
    const found = tree.find((n) => n.id === root.id);
    if (!found) throw new ResourceNotFoundError('Category');
    return found;
  },

  async getVendorDetail(vendorType: string, vendorId: string) {
    const vType = vendorType === 'freelancer' ? 'freelancer' : 'salon_location';
    const detail = await discoveryRepository.getVendorDetail(vendorType, vendorId);
    if (!detail) throw new ResourceNotFoundError('Vendor');

    const [services, reviews, gallery, workingHours] = await Promise.all([
      discoveryRepository.getVendorServices(vType, vendorId),
      discoveryRepository.getVendorReviews(vType, vendorId, 'recent', 10),
      discoveryRepository.getVendorGallery(vType, vendorId),
      discoveryRepository.getVendorWorkingHours(vType, vendorId),
    ]);

    // Staff + retail products only for salons. Use `vType` (normalised at
    // line 123) — direct calls via `/:vendorType/:vendorId` pass the raw URL
    // segment `'salon_location'`, while slug-resolved calls pass `'salon'`.
    let staff: unknown[] = [];
    let products: unknown[] = [];
    if (vType === 'salon_location') {
      [staff, products] = await Promise.all([
        discoveryRepository.getVendorStaff(vendorId),
        catalogRepository.listProducts(vType, vendorId),
      ]);
    }

    // Inject vendor_type explicitly — the freelancer_profiles / salon_locations
    // table rows don't carry the discriminator since each table implies it,
    // but downstream consumers (customer portal, mobile apps) need it on the
    // wire to render the correct profile chrome.
    return {
      ...detail,
      vendor_type: vType,
      services,
      reviews,
      gallery,
      working_hours: workingHours,
      staff,
      products,
    };
  },

  async getVendorReviews(vendorId: string, vendorType: string, sort: string, limit: number) {
    const vType = vendorType === 'freelancer' ? 'freelancer' : 'salon_location';
    const rows = await discoveryRepository.getVendorReviews(vType, vendorId, sort, limit);
    const hasMore = rows.length > limit;
    return { items: rows.slice(0, limit), hasMore };
  },

  // Public — increment a vendor's view counter. Called fire-and-forget by
  // customer apps and the public web portal when rendering a vendor page.
  async trackVendorView(vendorType: 'freelancer' | 'salon_location', vendorId: string) {
    const updated = await discoveryRepository.incrementVendorViewCount(vendorType, vendorId);
    return { tracked: updated };
  },

  async getFeaturedVendors(params: {
    vendorType?: 'freelancer' | 'salon_location'; limit: number;
  }) {
    return discoveryRepository.getFeaturedVendors(params);
  },

  async getTrendingVendors(params: {
    vendorType?: 'freelancer' | 'salon_location'; limit: number;
  }) {
    return discoveryRepository.getTrendingVendors(params);
  },

  async getVendorBySlug(slug: string, vendorType?: 'freelancer' | 'salon_location') {
    const hit = await discoveryRepository.getVendorBySlug(slug, vendorType);
    if (!hit) throw new ResourceNotFoundError('Vendor');
    // getVendorDetail's staff guard checks vendorType === 'salon' (not 'salon_location').
    // Normalise the DB enum value so salon staff aren't silently omitted.
    const normalizedType = hit.vendor_type === 'salon_location' ? 'salon' : hit.vendor_type;
    return this.getVendorDetail(normalizedType, hit.id);
  },

  async autocomplete(args: { q: string; city?: string; lat?: number; lng?: number }) {
    return discoveryRepository.autocomplete(args);
  },

  async nearYou(args: { lat: number; lng: number; limit: number }) {
    return discoveryRepository.nearYou(args);
  },

  async cityLanding(slug: string) {
    return discoveryRepository.cityLanding(slug);
  },

  async getVendorProfileBySlug(slug: string) {
    const agg = await discoveryRepository.getVendorProfileBySlug(slug);
    if (!agg) throw new ResourceNotFoundError('Vendor not found');

    const groups: Record<string, any> = {};
    for (const s of agg.services) {
      const key = s.category_slug ?? 'other';
      groups[key] ??= { category: { id: s.category_id, slug: s.category_slug, name: s.category_name }, services: [] };
      groups[key].services.push({
        id: s.id,
        name: s.name,
        priceInr: Math.round(Number(s.price)),
        durationMin: s.duration_minutes,
        genderTarget: s.gender_target,
        serviceMode: s.service_location,                              // pass-through 'onsite'|'home'|'both'
        photos: s.photos ?? [],
        ratingAvg: Number(s.rating_avg),
        ratingCount: s.rating_count,
      });
    }

    const isOpenNow = computeIsOpenNow(agg.hours);

    return {
      vendor: {
        id: agg.vendor.id,
        slug: agg.vendor.slug,
        name: agg.vendor.name,
        type: agg.vendor.vendor_type,
        ratingAvg: Number(agg.vendor.rating_avg ?? 0),
        ratingCount: agg.vendor.rating_count ?? 0,
        verified: agg.vendor.is_verified === true,
        phone: agg.vendor.phone,
        websiteUrl: agg.vendor.website_url,
      },
      gallery: agg.gallery,
      hours: agg.hours,
      isOpenNow,
      address: {
        line1: agg.vendor.address_line1,
        city:  agg.vendor.city,
        lat:   agg.vendor.lat !== null ? Number(agg.vendor.lat) : null,
        lng:   agg.vendor.lng !== null ? Number(agg.vendor.lng) : null,
        region: agg.vendor.region,
      },
      serviceGroups: Object.values(groups),
      products: agg.products.map((p: any) => ({
        id: p.id, name: p.name,
        priceInr: Math.round(Number(p.price)),
        category: p.category,
        photos: [],
        ratingAvg: Number(p.rating_avg),
        ratingCount: p.rating_count,
      })),
      badges: [agg.vendor.is_verified === true && 'verified'].filter(Boolean) as string[],
      reviewAggregate: {
        ratingAvg: Number(agg.reviewAggregate?.rating_avg ?? 0),
        ratingCount: agg.reviewAggregate?.rating_count ?? 0,
        breakdown: {
          1: agg.reviewAggregate?.r1 ?? 0,
          2: agg.reviewAggregate?.r2 ?? 0,
          3: agg.reviewAggregate?.r3 ?? 0,
          4: agg.reviewAggregate?.r4 ?? 0,
          5: agg.reviewAggregate?.r5 ?? 0,
        },
        photoCount: agg.reviewAggregate?.photo_count ?? 0,
      },
      similarVendorIds: agg.similarIds,
      faq: agg.faq,
    };
  },
};

// Computes "is the vendor open now?" from a polymorphic working_hours payload
// using the India Standard Time clock. No date library — Intl.DateTimeFormat only.
function computeIsOpenNow(hours: Array<{ dow: number; open: string; close: string; is_closed: boolean }>): boolean {
  if (!hours || hours.length === 0) return false;
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  // Map JS weekday-short → DOW (0=Sun..6=Sat). Use the locale tokens via formatToParts.
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = weekdayMap[parts.weekday as string];
  const nowTime = `${parts.hour}:${parts.minute}:${parts.second}`;
  for (const h of hours) {
    if (h.dow !== dow) continue;
    if (h.is_closed) return false;
    if (h.open <= nowTime && nowTime <= h.close) return true;
  }
  return false;
}
