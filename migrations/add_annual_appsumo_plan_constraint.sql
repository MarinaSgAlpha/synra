-- Allow the 'annual_appsumo' plan on subscriptions and organizations.
-- Run this in your Supabase SQL Editor.
--
-- Context: Synra's AppSumo deal converted from lifetime to annual. New
-- AppSumo customers get plan='annual_appsumo' with a 1-year
-- current_period_end. We KEEP 'lifetime_appsumo' in the allowed set so
-- any earlier rows (and the existing redemption code path) stay valid
-- — those customers were sold lifetime and we honor that.
--
-- Plan limits for annual_appsumo and lifetime_appsumo are identical
-- (see lib/usage-limits.ts). The plans differ only in expiry / renewal
-- handling (cron expiry at /api/cron/appsumo-expiry).
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
    'lifetime_appsumo'::text,
    'annual_appsumo'::text
  ]));

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_plan_check;
ALTER TABLE organizations ADD CONSTRAINT organizations_plan_check
  CHECK (plan = ANY (ARRAY[
    'free'::text,
    'starter'::text,
    'pro'::text,
    'team'::text,
    'lifetime'::text,
    'lifetime_appsumo'::text,
    'annual_appsumo'::text
  ]));
