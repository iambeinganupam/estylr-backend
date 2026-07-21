-- TYPE: seed-dev
-- Down migration for 066_seed_grooming_homepage.up.sql.
-- Removes grooming homepage callouts + testimonials seeded by the up.
-- Safe to run on any DB — DELETE silently no-ops on missing rows.

DELETE FROM public.platform_callouts
 WHERE context = 'homepage'
   AND key IN ('hero_title', 'hero_subtitle', 'hero_cta_primary', 'hero_cta_secondary', 'vendor_cta');

DELETE FROM public.platform_callouts
 WHERE context = 'homepage_how_it_works'
   AND text IN (
     'Browse trusted vendors near you.',
     'Pick a slot that works — book in seconds.',
     'Show up and look your best. We handle the rest.'
   );

DELETE FROM public.customer_testimonials
 WHERE customer_name IN ('Aanya Sharma','Rohit Verma','Meera Iyer','Karan Singh','Priya Nair')
   AND customer_city IN ('Bengaluru','Mumbai','Chennai','Delhi','Hyderabad');
