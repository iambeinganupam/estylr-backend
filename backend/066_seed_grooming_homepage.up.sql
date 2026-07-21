-- TYPE: seed-dev
-- Migration 066 (seed-dev): grooming homepage CMS content.
-- Only applied when SEED_DEV_DATA=true. Never runs in staging/prod.

-- ── Homepage hero (key + metadata) ──────────────────────────────────────────
INSERT INTO public.platform_callouts (context, key, icon, text, sort_order, is_active, metadata)
VALUES
  ('homepage', 'hero_title',         'sparkles',  'Daily grooming, on demand.', 0, TRUE, '{}'::jsonb),
  ('homepage', 'hero_subtitle',      'wand',      'Book trusted hair, makeup, skincare, spa & barber services near you.', 0, TRUE, '{}'::jsonb),
  ('homepage', 'hero_cta_primary',   'arrow',     'Find a service',   0, TRUE, '{"href":"/services"}'::jsonb),
  ('homepage', 'hero_cta_secondary', 'compass',   'Explore vendors',  0, TRUE, '{"href":"/vendors"}'::jsonb),
  ('homepage', 'vendor_cta',         'briefcase', 'Are you a grooming professional?', 0, TRUE,
     '{"href":"/vendor-portal","button_label":"List your business"}'::jsonb)
ON CONFLICT (context, key) WHERE key IS NOT NULL DO NOTHING;

-- ── How-it-works steps (key=NULL — use WHERE NOT EXISTS for idempotency) ────
INSERT INTO public.platform_callouts (context, key, icon, text, sort_order, is_active, metadata)
SELECT 'homepage_how_it_works', NULL, icon, text, sort_order, TRUE, '{}'::jsonb
FROM (VALUES
  ('search',   'Browse trusted vendors near you.',                10),
  ('calendar', 'Pick a slot that works — book in seconds.',       20),
  ('sparkle',  'Show up and look your best. We handle the rest.', 30)
) AS s(icon, text, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.platform_callouts pc
   WHERE pc.context = 'homepage_how_it_works'
     AND pc.text    = s.text
);

-- ── 5 grooming testimonials (WHERE NOT EXISTS for idempotency) ───────────────
INSERT INTO public.customer_testimonials
  (customer_name, customer_city, quote, rating, photo_url, is_published, sort_order)
SELECT customer_name, customer_city, quote, rating, NULL, TRUE, sort_order
FROM (VALUES
  ('Aanya Sharma',  'Bengaluru', 'Booked a facial on a Sunday morning — the therapist showed up on time and was lovely. New favourite app.', 5::smallint, 10),
  ('Rohit Verma',   'Mumbai',    'Found a great barber two streets away. Three taps, done. Will never go back to walk-ins.',                 5::smallint, 20),
  ('Meera Iyer',    'Chennai',   'The makeup artist for my birthday was exactly what the portfolio showed. Loved it.',                       5::smallint, 30),
  ('Karan Singh',   'Delhi',     'My weekly massage is now an actual habit. Easy to reschedule when work gets crazy.',                       4::smallint, 40),
  ('Priya Nair',    'Hyderabad', 'Did my pre-festival mani-pedi last week. So much easier than calling around.',                             5::smallint, 50)
) AS t(customer_name, customer_city, quote, rating, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.customer_testimonials ct
   WHERE ct.customer_name = t.customer_name
     AND ct.quote         = t.quote
);
