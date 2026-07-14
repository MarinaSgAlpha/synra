-- Allow the new 'solo' plan on subscriptions and organizations.
-- Run this in your Supabase SQL Editor.
--
-- Context: Synra closed the free tier to new signups (existing free orgs
-- are grandfathered by creation date — see FREE_TIER_CUTOFF in
-- lib/subscription-access.ts). 'solo' is the new entry SKU:
--   * $9.99/month via Stripe (STRIPE_PRICE_ID_SOLO)
--   * 7-day trial applied at checkout
--   * 1 database connection, 1,000 requests/day
--
-- We KEEP 'free' in the allowed set for grandfathered rows and for the
-- webhook downgrade path (canceled subscriptions revert the org to
-- 'free'; post-cutoff orgs on 'free' simply have no product access).
--
-- Safe to run on existing data: no rows are modified and every current
-- value remains within the allowed set.

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan = ANY (ARRAY[
    'free'::text,
    'solo'::text,
    'starter'::text,
    'pro'::text,
    'team'::text,
    'lifetime'::text,
    'lifetime_appsumo'::text,
    'annual'::text,
    'annual_appsumo'::text
  ]));

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_plan_check;
ALTER TABLE organizations ADD CONSTRAINT organizations_plan_check
  CHECK (plan = ANY (ARRAY[
    'free'::text,
    'solo'::text,
    'starter'::text,
    'pro'::text,
    'team'::text,
    'lifetime'::text,
    'lifetime_appsumo'::text,
    'annual'::text,
    'annual_appsumo'::text
  ]));
