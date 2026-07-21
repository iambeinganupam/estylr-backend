-- TYPE: schema
-- Down migration for 006_engagement_and_media.up.sql
-- Removes: media_items, notifications, favorites, reviews tables,
--          refresh_vendor_rating function, related indexes, triggers,
--          media_type, notification_type enums

DROP TRIGGER IF EXISTS trg_media_updated_at ON public.media_items;
DROP TRIGGER IF EXISTS trg_notifications_updated_at ON public.notifications;
DROP TRIGGER IF EXISTS trg_reviews_updated_at ON public.reviews;
DROP TRIGGER IF EXISTS trg_refresh_rating ON public.reviews;

DROP INDEX IF EXISTS idx_media_vendor;
DROP INDEX IF EXISTS idx_notifications_user;
DROP INDEX IF EXISTS idx_favorites_customer;
DROP INDEX IF EXISTS idx_reviews_customer;
DROP INDEX IF EXISTS idx_reviews_vendor;

DROP TABLE IF EXISTS public.media_items CASCADE;
DROP TABLE IF EXISTS public.notifications CASCADE;
DROP TABLE IF EXISTS public.favorites CASCADE;
DROP TABLE IF EXISTS public.reviews CASCADE;

DROP FUNCTION IF EXISTS public.refresh_vendor_rating() CASCADE;

DROP TYPE IF EXISTS media_type;
DROP TYPE IF EXISTS notification_type;
