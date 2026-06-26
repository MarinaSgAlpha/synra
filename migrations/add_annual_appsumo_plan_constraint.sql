-- Allow the new annual plans ('annual' for Stripe $149/year, and
-- 'annual_appsumo' for the AppSumo $99/year SKU) on subscriptions
-- and organizations. Run this in your Supabase SQL Editor.
--
-- Context: Synra converted from a Lifetime deal to an Annual model.
--   * 'annual'         = Stripe-billed $149/year, advertised on the
--                        public marketing site.
--   * 'annual_appsumo' = AppSumo-billed $99/year, redeemed via the
--                        /appsumo/redeem flow.
--
-- Both plans share the same usage limits and the same yearly cadence;
-- they are kept distinct because (a) refund / deactivate paths for
-- AppSumo should never touch a real Stripe customer, and (b) revenue
-- attribution stays clean for analytics.
--
-- We KEEP 'lifetime' and 'lifetime_appsumo' in the allowed set so any
-- grandfathered rows continue to validate. Both old SKUs are still
-- functional in code; only the public marketing copy moved away.
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
    'annual'::text,
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
    'annual'::text,
    'annual_appsumo'::text
  ]));
