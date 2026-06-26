/**
 * Pure-ish helpers powering the daily AppSumo expiry cron.
 *
 * Two responsibilities:
 *
 *   1. Find AppSumo annual subscriptions whose period is ending and
 *      send the user a renewal warning ~30 days out.
 *
 *   2. Find AppSumo annual subscriptions whose period has ended and
 *      downgrade them to free + status='expired'.
 *
 * Idempotency is enforced via the `audit_logs` table — we never resend
 * a warning / expiry email for the same period_end value. That means
 * the cron is safe to invoke multiple times per day (e.g. by a manual
 * curl from a developer) without spamming users.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { APPSUMO_PLAN } from './redeem'

export const RENEWAL_WARNING_WINDOW_DAYS = 30

/**
 * Audit-log action names used as dedup keys for outbound notifications.
 * Format: action='appsumo_warning_sent', resource_type='subscription',
 * resource_id=<subscription.id>, metadata={ period_end_iso: '...' }
 *
 * We include period_end_iso in metadata so that if the user renews and
 * the period_end shifts to a new value, future warnings can re-fire
 * for the new period without colliding with the old ledger row.
 */
export const AUDIT_ACTION_WARNING = 'appsumo_renewal_warning_sent'
export const AUDIT_ACTION_EXPIRED = 'appsumo_expired'

export interface ExpiringSubscription {
  id: string
  organization_id: string
  current_period_end: string
  organizations: {
    id: string
    name: string
  }
}

/**
 * Subscriptions where:
 *   plan = 'annual_appsumo'
 *   status = 'active'
 *   current_period_end is between now and now + RENEWAL_WARNING_WINDOW_DAYS
 *
 * We intentionally fetch the whole window (not just "exactly 30 days
 * out") so a cron that missed a day still catches everyone before
 * they expire.
 */
export async function findSubsNeedingRenewalWarning(
  admin: SupabaseClient,
  now: Date = new Date()
): Promise<ExpiringSubscription[]> {
  const windowEnd = new Date(now)
  windowEnd.setUTCDate(windowEnd.getUTCDate() + RENEWAL_WARNING_WINDOW_DAYS)

  const { data, error } = await admin
    .from('subscriptions')
    .select(
      'id, organization_id, current_period_end, organizations(id, name)'
    )
    .eq('plan', APPSUMO_PLAN)
    .eq('status', 'active')
    .gte('current_period_end', now.toISOString())
    .lte('current_period_end', windowEnd.toISOString())

  if (error) {
    throw new Error(`findSubsNeedingRenewalWarning failed: ${error.message}`)
  }
  return ((data ?? []) as unknown) as ExpiringSubscription[]
}

/**
 * Subscriptions where:
 *   plan = 'annual_appsumo'
 *   status = 'active'
 *   current_period_end < now
 *
 * These have already lapsed. The cron downgrades them and sends the
 * post-expiry email.
 */
export async function findSubsToExpire(
  admin: SupabaseClient,
  now: Date = new Date()
): Promise<ExpiringSubscription[]> {
  const { data, error } = await admin
    .from('subscriptions')
    .select(
      'id, organization_id, current_period_end, organizations(id, name)'
    )
    .eq('plan', APPSUMO_PLAN)
    .eq('status', 'active')
    .lt('current_period_end', now.toISOString())

  if (error) {
    throw new Error(`findSubsToExpire failed: ${error.message}`)
  }
  return ((data ?? []) as unknown) as ExpiringSubscription[]
}

/**
 * Check whether we've already logged the given audit action for the
 * subscription at the given period_end. Used to suppress duplicate
 * emails / duplicate expiry processing across cron runs.
 */
export async function hasAuditEntryFor(
  admin: SupabaseClient,
  params: {
    organizationId: string
    action: typeof AUDIT_ACTION_WARNING | typeof AUDIT_ACTION_EXPIRED
    subscriptionId: string
    periodEndIso: string
  }
): Promise<boolean> {
  const { data, error } = await admin
    .from('audit_logs')
    .select('id, metadata')
    .eq('organization_id', params.organizationId)
    .eq('action', params.action)
    .eq('resource_type', 'subscription')
    .eq('resource_id', params.subscriptionId)
    .limit(50)

  if (error) {
    throw new Error(`hasAuditEntryFor failed: ${error.message}`)
  }

  // The same subscription can legitimately receive multiple warnings
  // across multiple renewal cycles — dedupe only against the *current*
  // period_end, not against all rows for this subscription.
  return (data ?? []).some(
    (row) =>
      (row.metadata as { period_end_iso?: string } | null)?.period_end_iso ===
      params.periodEndIso
  )
}

/**
 * Record that we've sent a warning / expired email for this period.
 * Always writes a fresh row — callers should use hasAuditEntryFor
 * first to avoid duplicates.
 */
export async function recordAuditEntry(
  admin: SupabaseClient,
  params: {
    organizationId: string
    action: typeof AUDIT_ACTION_WARNING | typeof AUDIT_ACTION_EXPIRED
    subscriptionId: string
    periodEndIso: string
    extra?: Record<string, unknown>
  }
): Promise<void> {
  const { error } = await admin.from('audit_logs').insert({
    organization_id: params.organizationId,
    action: params.action,
    resource_type: 'subscription',
    resource_id: params.subscriptionId,
    metadata: {
      period_end_iso: params.periodEndIso,
      ...(params.extra ?? {}),
    },
  })
  if (error) {
    throw new Error(`recordAuditEntry failed: ${error.message}`)
  }
}

/**
 * Flip an AppSumo annual subscription (and its parent org) to the
 * free tier. The previous current_period_end is left intact on the
 * subscription row for support visibility — only `status` and `plan`
 * change.
 */
export async function expireSubscription(
  admin: SupabaseClient,
  subscriptionId: string,
  organizationId: string
): Promise<void> {
  const nowIso = new Date().toISOString()

  const { error: subError } = await admin
    .from('subscriptions')
    .update({
      status: 'expired',
      plan: 'free',
      cancel_at_period_end: false,
      updated_at: nowIso,
    })
    .eq('id', subscriptionId)

  if (subError) {
    throw new Error(
      `expireSubscription: subscription update failed for ${subscriptionId}: ${subError.message}`
    )
  }

  const { error: orgError } = await admin
    .from('organizations')
    .update({ plan: 'free', updated_at: nowIso })
    .eq('id', organizationId)

  if (orgError) {
    throw new Error(
      `expireSubscription: organization update failed for ${organizationId}: ${orgError.message}`
    )
  }
}

/**
 * Look up the AppSumo redeemer's email so the cron can address the
 * renewal/expiry mail to them rather than to a generic org contact.
 * Falls back to the first organization owner if the AppSumo redeemer
 * has since left the org.
 */
export async function resolveBillingEmail(
  admin: SupabaseClient,
  organizationId: string
): Promise<{ email: string | null; userId: string | null }> {
  const { data: appsumoCode } = await admin
    .from('appsumo_codes')
    .select('redeemed_by_user_id')
    .eq('organization_id', organizationId)
    .eq('status', 'activated')
    .order('activated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const candidateIds: string[] = []
  if (appsumoCode?.redeemed_by_user_id) {
    candidateIds.push(appsumoCode.redeemed_by_user_id)
  }

  // Always include the first org owner as a fallback.
  const { data: owner } = await admin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', organizationId)
    .eq('role', 'owner')
    .eq('status', 'active')
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (owner?.user_id && !candidateIds.includes(owner.user_id)) {
    candidateIds.push(owner.user_id)
  }

  for (const userId of candidateIds) {
    const { data: user } = await admin
      .from('users')
      .select('email')
      .eq('id', userId)
      .maybeSingle()
    if (user?.email) return { email: user.email, userId }
  }

  return { email: null, userId: null }
}
