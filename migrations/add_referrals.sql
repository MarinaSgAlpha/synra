-- Referral program ("give a month, get a month").
-- Run this in your Supabase SQL Editor.
--
--   * organizations.referral_code — shareable code, generated lazily the
--     first time an org opens the referral card (or at org creation for
--     new signups).
--   * organizations.referred_by_organization_id — set at signup when a
--     valid ?ref= code was captured.
--   * referrals — one row per referred org. status flips from
--     'signed_up' to 'rewarded' when the referred org pays its first
--     real invoice and the referrer's Stripe balance is credited.
--
-- Safe to run on existing data: adds columns/tables only.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS referral_code text UNIQUE;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS referred_by_organization_id uuid REFERENCES organizations(id);

CREATE TABLE IF NOT EXISTS referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_organization_id uuid NOT NULL REFERENCES organizations(id),
  referred_organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id),
  status text NOT NULL DEFAULT 'signed_up' CHECK (status IN ('signed_up', 'rewarded')),
  reward_amount_cents integer,
  rewarded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals (referrer_organization_id);

-- Service-role (admin) client bypasses RLS; enabling it with no policies
-- blocks direct anon/authenticated access, matching the other tables.
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
