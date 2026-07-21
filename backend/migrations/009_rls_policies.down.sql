-- TYPE: schema
-- Down migration for 009_rls_policies.up.sql
-- Removes: all RLS policies and disables RLS on affected tables

-- Drop policies
DROP POLICY IF EXISTS transactions_access ON public.transactions;
DROP POLICY IF EXISTS bank_accounts_own ON public.bank_accounts;
DROP POLICY IF EXISTS reviews_update ON public.reviews;
DROP POLICY IF EXISTS reviews_write ON public.reviews;
DROP POLICY IF EXISTS reviews_read ON public.reviews;
DROP POLICY IF EXISTS planner_own ON public.planner_events;
DROP POLICY IF EXISTS events_own ON public.events;
DROP POLICY IF EXISTS favorites_own ON public.favorites;
DROP POLICY IF EXISTS notifications_own ON public.notifications;
DROP POLICY IF EXISTS intents_own ON public.booking_intents;
DROP POLICY IF EXISTS appointments_access ON public.appointments;
DROP POLICY IF EXISTS customer_own_profile ON public.customer_profiles;
DROP POLICY IF EXISTS users_own_row ON public.users;

-- Disable RLS
ALTER TABLE public.planner_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_intents DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_members DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.salon_locations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.freelancer_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.users NO FORCE ROW LEVEL SECURITY;
