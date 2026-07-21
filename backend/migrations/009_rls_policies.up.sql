-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 009_rls_policies
-- Description: Row Level Security policies for PostgreSQL (Supabase compatible)
-- ─────────────────────────────────────────────────────────────────────────────
-- RLS ensures a compromised app-layer token cannot read another tenant's data
-- at the DATABASE level — last line of defense.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Enable RLS on all sensitive tables ──
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.freelancer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salon_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planner_events ENABLE ROW LEVEL SECURITY;

-- ── Service Role (backend API) bypasses all RLS ──
-- Our Node.js backend uses the service role key — it can read any row.
-- RLS protects against direct Supabase client SDK calls from frontends.
-- This policy allows the service role to do everything:
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;

-- ── Users: own row only ──
CREATE POLICY users_own_row ON public.users
  USING (id = auth.uid());

-- ── Customer Profiles: own profile only ──
CREATE POLICY customer_own_profile ON public.customer_profiles
  USING (user_id = auth.uid());

-- ── Appointments: own (customer) or own vendor's ──
CREATE POLICY appointments_access ON public.appointments
  USING (
    customer_id = auth.uid()
    OR vendor_id = auth.uid()
    OR staff_member_id IN (
      SELECT id FROM public.staff_members WHERE user_id = auth.uid()
    )
  );

-- ── Booking Intents: own only ──
CREATE POLICY intents_own ON public.booking_intents
  USING (customer_id = auth.uid());

-- ── Notifications: own user only ──
CREATE POLICY notifications_own ON public.notifications
  USING (user_id = auth.uid());

-- ── Favorites: own user only ──
CREATE POLICY favorites_own ON public.favorites
  USING (customer_id = auth.uid());

-- ── Events: own organizer ──
CREATE POLICY events_own ON public.events
  USING (organizer_id = auth.uid());

-- ── Planner Events: own user ──
CREATE POLICY planner_own ON public.planner_events
  USING (user_id = auth.uid());

-- ── Reviews: readable by all (reviews are public), writable by own customer ──
CREATE POLICY reviews_read ON public.reviews
  FOR SELECT USING (is_visible = TRUE);

CREATE POLICY reviews_write ON public.reviews
  FOR INSERT WITH CHECK (customer_id = auth.uid());

CREATE POLICY reviews_update ON public.reviews
  FOR UPDATE USING (customer_id = auth.uid() OR vendor_id = auth.uid());

-- ── Bank Accounts: own vendor ──
CREATE POLICY bank_accounts_own ON public.bank_accounts
  USING (vendor_id = auth.uid());

-- ── Transactions: own vendor or own customer ──
CREATE POLICY transactions_access ON public.transactions
  USING (
    vendor_id = auth.uid()
    OR appointment_id IN (
      SELECT id FROM public.appointments WHERE customer_id = auth.uid()
    )
  );
