/**
 * Shared linking logic that turns a verified AppSumo license_key into an
 * upgraded subscription on Synra. Used by:
 *
 *   - /api/appsumo/redeem        (after a user completes OAuth)
 *   - /api/appsumo/webhook       (no-op idempotent re-runs from activate
 *                                 events when the user has already
 *                                 redeemed via OAuth)
 *
 * All Supabase writes go through the service-role admin client; we never
 * trust the caller's session for these mutations.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const APPSUMO_PLAN = 'lifetime_appsumo' as const

export type LinkLicenseResult =
  | { ok: true; organizationId: string; alreadyLinkedToSameOrg?: boolean }
  | { ok: false; reason: 'already_redeemed'; existingOrganizationId: string }
  | { ok: false; reason: 'license_deactivated' }
  | { ok: false; reason: 'unknown_license' }

interface LinkLicenseInput {
  licenseKey: string
  organizationId: string
  userId: string
  /** Tier from the OAuth flow / webhook payload; we store it for support. */
  tier?: number | null
  /** Raw payload (OAuth license response or webhook body) for the audit row. */
  payload?: Record<string, unknown>
}

/**
 * Atomically link an AppSumo license_key to an organization and upgrade
 * that organization to the AppSumo lifetime plan.
 *
 * Idempotent: if the license is already linked to the same org we return
 * `alreadyLinkedToSameOrg: true` and skip the writes. If it's linked to a
 * *different* org we refuse — one-time use is the whole point.
 */
export async function linkLicenseToOrganization(
  admin: SupabaseClient,
  input: LinkLicenseInput
): Promise<LinkLicenseResult> {
  const { licenseKey, organizationId, userId, tier, payload } = input

  const { data: existing, error: lookupError } = await admin
    .from('appsumo_codes')
    .select('id, organization_id, status')
    .eq('license_key', licenseKey)
    .maybeSingle()

  if (lookupError) {
    throw new Error(
      `appsumo_codes lookup failed for license ${licenseKey}: ${lookupError.message}`
    )
  }

  if (existing?.status === 'deactivated') {
    return { ok: false, reason: 'license_deactivated' }
  }

  // Different org has already claimed it — refuse.
  if (
    existing?.organization_id &&
    existing.organization_id !== organizationId
  ) {
    return {
      ok: false,
      reason: 'already_redeemed',
      existingOrganizationId: existing.organization_id,
    }
  }

  // Same org re-running the flow — return success without re-writing the
  // subscription. The org is already on lifetime_appsumo.
  if (existing?.organization_id === organizationId) {
    return { ok: true, organizationId, alreadyLinkedToSameOrg: true }
  }

  const nowIso = new Date().toISOString()

  // Upsert the appsumo_codes row. Webhook may have inserted a 'purchased'
  // row already; if not, we insert one here.
  const upsertPayload = {
    license_key: licenseKey,
    organization_id: organizationId,
    redeemed_by_user_id: userId,
    status: 'activated' as const,
    activated_at: nowIso,
    tier: tier ?? null,
    last_event: 'oauth_redeem',
    last_payload: payload ?? null,
  }

  const { error: upsertError } = await admin
    .from('appsumo_codes')
    .upsert(upsertPayload, { onConflict: 'license_key' })

  if (upsertError) {
    throw new Error(
      `appsumo_codes upsert failed for license ${licenseKey}: ${upsertError.message}`
    )
  }

  // Flip the org + subscription to AppSumo lifetime. Per the product
  // spec: stripe_* fields stay null (AppSumo is NOT a Stripe customer)
  // and current_period_* stay null (lifetime never expires).
  const { error: subError } = await admin
    .from('subscriptions')
    .update({
      stripe_customer_id: null,
      stripe_subscription_id: null,
      status: 'active',
      plan: APPSUMO_PLAN,
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: false,
      updated_at: nowIso,
    })
    .eq('organization_id', organizationId)

  if (subError) {
    throw new Error(
      `subscriptions update to ${APPSUMO_PLAN} failed for org ${organizationId}: ${subError.message}`
    )
  }

  const { error: orgError } = await admin
    .from('organizations')
    .update({ plan: APPSUMO_PLAN, updated_at: nowIso })
    .eq('id', organizationId)

  if (orgError) {
    throw new Error(
      `organizations update to ${APPSUMO_PLAN} failed for org ${organizationId}: ${orgError.message}`
    )
  }

  return { ok: true, organizationId }
}

/**
 * Reverse a redemption: flip the organization (and its subscription row)
 * back to the free plan and mark the code deactivated. Called by the
 * `deactivate` webhook handler when AppSumo signals a refund or revoke.
 *
 * Idempotent: safe to call repeatedly. If the code was never linked to
 * an org we still mark it deactivated (in case it gets reactivated later).
 */
export async function deactivateLicense(
  admin: SupabaseClient,
  licenseKey: string,
  payload?: Record<string, unknown>
): Promise<{ organizationId: string | null }> {
  const nowIso = new Date().toISOString()

  const { data: existing } = await admin
    .from('appsumo_codes')
    .select('id, organization_id, status')
    .eq('license_key', licenseKey)
    .maybeSingle()

  const orgId = existing?.organization_id ?? null

  // Always mark the code deactivated. Upsert handles the case where
  // we somehow never recorded the purchase (e.g. webhook lost).
  const { error: upsertError } = await admin.from('appsumo_codes').upsert(
    {
      license_key: licenseKey,
      organization_id: orgId,
      status: 'deactivated' as const,
      deactivated_at: nowIso,
      last_event: 'deactivate',
      last_payload: payload ?? null,
    },
    { onConflict: 'license_key' }
  )

  if (upsertError) {
    throw new Error(
      `appsumo_codes deactivate upsert failed for license ${licenseKey}: ${upsertError.message}`
    )
  }

  if (!orgId) {
    return { organizationId: null }
  }

  // Flip org + subscription back to free. We keep stripe_* null (this
  // was an AppSumo customer, never had a Stripe relationship).
  const { error: subError } = await admin
    .from('subscriptions')
    .update({
      status: 'canceled',
      plan: 'free',
      stripe_customer_id: null,
      stripe_subscription_id: null,
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: false,
      updated_at: nowIso,
    })
    .eq('organization_id', orgId)

  if (subError) {
    throw new Error(
      `subscriptions downgrade to free failed for org ${orgId}: ${subError.message}`
    )
  }

  const { error: orgError } = await admin
    .from('organizations')
    .update({ plan: 'free', updated_at: nowIso })
    .eq('id', orgId)

  if (orgError) {
    throw new Error(
      `organizations downgrade to free failed for org ${orgId}: ${orgError.message}`
    )
  }

  return { organizationId: orgId }
}
