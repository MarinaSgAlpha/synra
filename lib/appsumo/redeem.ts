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

/**
 * Default plan we assign on a fresh AppSumo redemption. The earlier
 * lifetime deal used 'lifetime_appsumo'; the current AppSumo SKU is
 * annual, so new redemptions land here. The lifetime constant is kept
 * exported so older callers / scripts can still reference it.
 */
export const APPSUMO_PLAN = 'annual_appsumo' as const
export const APPSUMO_LIFETIME_PLAN = 'lifetime_appsumo' as const

/**
 * Number of days an AppSumo annual subscription is valid for after a
 * successful redemption / renewal event.
 */
export const APPSUMO_ANNUAL_PERIOD_DAYS = 365

/**
 * Plans that the AppSumo flow legitimately leaves on an organization.
 * Used by the cron to scope sweeps to AppSumo-owned subscriptions.
 */
export const APPSUMO_PLANS = [APPSUMO_PLAN, APPSUMO_LIFETIME_PLAN] as const

function addDaysIso(base: Date, days: number): string {
  const next = new Date(base)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString()
}

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

  // Flip the org + subscription to AppSumo annual. Per the product
  // spec: stripe_* fields stay null (AppSumo is NOT a Stripe customer);
  // current_period_start = now, current_period_end = +1 year. The
  // daily cron at /api/cron/appsumo-expiry sweeps expired rows back
  // to free.
  const periodEndIso = addDaysIso(new Date(nowIso), APPSUMO_ANNUAL_PERIOD_DAYS)
  const { error: subError } = await admin
    .from('subscriptions')
    .update({
      stripe_customer_id: null,
      stripe_subscription_id: null,
      status: 'active',
      plan: APPSUMO_PLAN,
      current_period_start: nowIso,
      current_period_end: periodEndIso,
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
 * Extend an AppSumo annual subscription by one year from its existing
 * `current_period_end` (not from now). Called when the webhook receives
 * an `activate` event for a license_key that's already linked + already
 * activated — we interpret that as AppSumo signalling a renewal.
 *
 * - If the current_period_end is in the future, we extend from that
 *   point so users renewing early aren't penalized for the unused tail
 *   of their existing year.
 * - If it's in the past (e.g. they let it lapse, the cron downgraded
 *   them, and they renewed via AppSumo), we extend from now() and
 *   reactivate the org's plan to annual_appsumo.
 *
 * No-op for non-annual subscriptions — lifetime_appsumo grandfathered
 * customers never expire and shouldn't have their periods touched.
 */
export type ExtendAnnualResult =
  | { extended: true; newPeriodEnd: string; reactivated: boolean }
  | { extended: false; reason: 'no_subscription' | 'not_annual' }

export async function extendAnnualPeriod(
  admin: SupabaseClient,
  organizationId: string
): Promise<ExtendAnnualResult> {
  const { data: sub, error: subError } = await admin
    .from('subscriptions')
    .select('id, plan, status, current_period_end')
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (subError) {
    throw new Error(
      `extendAnnualPeriod: subscription lookup failed for org ${organizationId}: ${subError.message}`
    )
  }
  if (!sub) return { extended: false, reason: 'no_subscription' }

  // Only extend AppSumo annual. Lifetime grandfathered customers never
  // expire — pretend the extend was a no-op and let the activate event
  // settle on the appsumo_codes row alone.
  if (sub.plan !== APPSUMO_PLAN) {
    return { extended: false, reason: 'not_annual' }
  }

  const now = new Date()
  const currentEnd = sub.current_period_end
    ? new Date(sub.current_period_end)
    : null
  const startFrom = currentEnd && currentEnd > now ? currentEnd : now
  const newPeriodEnd = addDaysIso(startFrom, APPSUMO_ANNUAL_PERIOD_DAYS)
  const wasExpired = sub.status === 'expired'

  const { error: updateError } = await admin
    .from('subscriptions')
    .update({
      plan: APPSUMO_PLAN, // restore plan in case the cron downgraded to free
      status: 'active',
      current_period_end: newPeriodEnd,
      cancel_at_period_end: false,
      updated_at: now.toISOString(),
    })
    .eq('id', sub.id)

  if (updateError) {
    throw new Error(
      `extendAnnualPeriod: subscription update failed for org ${organizationId}: ${updateError.message}`
    )
  }

  if (wasExpired) {
    // The cron previously downgraded the org to free — bring it back.
    const { error: orgError } = await admin
      .from('organizations')
      .update({ plan: APPSUMO_PLAN, updated_at: now.toISOString() })
      .eq('id', organizationId)
    if (orgError) {
      throw new Error(
        `extendAnnualPeriod: org plan restore failed for org ${organizationId}: ${orgError.message}`
      )
    }
  }

  return {
    extended: true,
    newPeriodEnd,
    reactivated: wasExpired,
  }
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
