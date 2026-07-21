-- TYPE: schema
-- Down migration for 007_events_and_cms.up.sql
-- Removes: planner_tasks, planner_events, newsletter_subscribers, contact_leads,
--          cms_pages, event_templates, event_attendees, events tables,
--          related indexes, triggers,
--          inquiry_type, cms_status, event_status enums

DROP TRIGGER IF EXISTS trg_cms_updated_at ON public.cms_pages;
DROP TRIGGER IF EXISTS trg_events_updated_at ON public.events;

DROP INDEX IF EXISTS idx_planner_tasks_event;
DROP INDEX IF EXISTS idx_planner_user;
DROP INDEX IF EXISTS idx_contact_leads_created;
DROP INDEX IF EXISTS idx_cms_status;
DROP INDEX IF EXISTS idx_cms_slug;
DROP INDEX IF EXISTS idx_events_organizer;

DROP TABLE IF EXISTS public.planner_tasks CASCADE;
DROP TABLE IF EXISTS public.planner_events CASCADE;
DROP TABLE IF EXISTS public.newsletter_subscribers CASCADE;
DROP TABLE IF EXISTS public.contact_leads CASCADE;
DROP TABLE IF EXISTS public.cms_pages CASCADE;
DROP TABLE IF EXISTS public.event_templates CASCADE;
DROP TABLE IF EXISTS public.event_attendees CASCADE;
DROP TABLE IF EXISTS public.events CASCADE;

DROP TYPE IF EXISTS inquiry_type;
DROP TYPE IF EXISTS cms_status;
DROP TYPE IF EXISTS event_status;
