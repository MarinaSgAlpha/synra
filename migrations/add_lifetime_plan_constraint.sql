-- Allow the 'lifetime' plan on subscriptions and organizations.
-- Run this in your Supabase SQL Editor.
--
-- Background: the original CHECK constraints only permitted
-- ('free','starter','pro','team'). Lifetime checkout (mode: 'payment')
-- writes plan = 'lifetime', which silently failed the DB write, leaving
-- lifetime buyers stuck on the free plan. This adds 'lifetime' to both
-- constraints. Safe to run on existing data — no rows are modified, and
-- every current value remains within the allowed set.

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan = ANY (ARRAY['free'::text, 'starter'::text, 'pro'::text, 'team'::text, 'lifetime'::text]));

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_plan_check;
ALTER TABLE organizations ADD CONSTRAINT organizations_plan_check
  CHECK (plan = ANY (ARRAY['free'::text, 'starter'::text, 'pro'::text, 'team'::text, 'lifetime'::text]));
