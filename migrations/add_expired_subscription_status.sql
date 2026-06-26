-- Allow status='expired' on subscriptions.
-- Run this in your Supabase SQL Editor.
--
-- Context: AppSumo annual subscriptions auto-downgrade to free when
-- their current_period_end is in the past (via the daily
-- /api/cron/appsumo-expiry job). We use status='expired' rather than
-- the existing 'canceled' so support can tell apart "the user asked us
-- to cancel" from "the AppSumo year ran out and they didn't renew".
--
-- Safe to run on existing data: no rows are modified, and every
-- current value remains within the allowed set.

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check
  CHECK (status = ANY (ARRAY[
    'active'::text,
    'canceled'::text,
    'past_due'::text,
    'trialing'::text,
    'incomplete'::text,
    'expired'::text
  ]));
