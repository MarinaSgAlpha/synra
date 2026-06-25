-- Allow the 'lifetime_appsumo' plan on subscriptions and organizations.
-- Run this in your Supabase SQL Editor.
--
-- Context: lifetime_appsumo is the lifetime tier sold via the AppSumo
-- marketplace. It's distinct from the Stripe 'lifetime' plan so we can:
--   * tell AppSumo lifetime customers apart from Stripe ones in the dashboard
--   * route refund webhooks correctly (AppSumo 'deactivate' must flip back
--     to free, regardless of Stripe state)
--   * report on AppSumo revenue separately
--
-- Plan limits for lifetime_appsumo mirror the Stripe lifetime tier
-- (see lib/usage-limits.ts).
--
-- Safe to run on existing data: no rows are modified and every current
-- value remains within the allowed set.

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan = ANY (ARRAY[
    'free'::text,
    'starter'::text,
    'pro'::text,
    'team'::text,
    'lifetime'::text,
    'lifetime_appsumo'::text
  ]));

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_plan_check;
ALTER TABLE organizations ADD CONSTRAINT organizations_plan_check
  CHECK (plan = ANY (ARRAY[
    'free'::text,
    'starter'::text,
    'pro'::text,
    'team'::text,
    'lifetime'::text,
    'lifetime_appsumo'::text
  ]));
