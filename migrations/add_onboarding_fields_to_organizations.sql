-- Onboarding fields collected after signup (both Google OAuth and email/password).
--
-- Context: Google OAuth redirects users straight to the provider, so we can't
-- collect profile questions inline on the signup form. Instead every new user
-- goes through a shared /onboarding step after first login. These columns store
-- those answers; onboarding_completed_at gates whether the step still shows.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS industry TEXT,
  ADD COLUMN IF NOT EXISTS referral_source TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN organizations.industry IS 'Industry the user selected during onboarding.';
COMMENT ON COLUMN organizations.referral_source IS 'How the user heard about Synra (onboarding answer).';
COMMENT ON COLUMN organizations.onboarding_completed_at IS 'When the user finished onboarding. NULL = onboarding still pending.';
