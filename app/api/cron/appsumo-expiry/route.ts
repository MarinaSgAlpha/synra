/**
 * Daily AppSumo annual expiry sweep.
 *
 *   POST /api/cron/appsumo-expiry
 *   Authorization: Bearer ${CRON_SECRET}
 *
 * Two passes:
 *
 *   1. RENEWAL WARNING — for AppSumo annual subscriptions whose
 *      current_period_end is within the next 30 days, send the
 *      renewal warning email (with a $19/mo Starter CTA) and log it
 *      to audit_logs so we don't resend.
 *
 *   2. EXPIRY SWEEP — for AppSumo annual subscriptions whose
 *      current_period_end is already in the past, downgrade the org
 *      to free + status='expired', send the post-expiry email, and
 *      log it.
 *
 * Idempotent: safe to invoke multiple times per day. Email sends
 * are deduped against audit_logs keyed by (subscription_id,
 * period_end_iso) so re-runs don't spam users, and a manual rerun
 * after a Railway cron failure will correctly resume.
 *
 * Railway setup:
 *   1. Create a new service in the same project as the app.
 *   2. Use a small image with curl available (e.g. `alpine/curl`).
 *   3. Set the start command to:
 *
 *        curl -fsSL -X POST \
 *          -H "Authorization: Bearer $CRON_SECRET" \
 *          https://app.mcpserver.design/api/cron/appsumo-expiry
 *
 *   4. Set the cron schedule (UTC) — e.g. `0 12 * * *` for noon daily.
 *   5. Set CRON_SECRET and APP_URL env vars on the cron service to
 *      match the values on the app service.
 *
 * Alternative: any other cron platform (GitHub Actions, EasyCron,
 * cron-job.org) that can issue a POST with a Bearer header works just
 * as well.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  AUDIT_ACTION_EXPIRED,
  AUDIT_ACTION_WARNING,
  expireSubscription,
  findSubsNeedingRenewalWarning,
  findSubsToExpire,
  hasAuditEntryFor,
  recordAuditEntry,
  resolveBillingEmail,
} from '@/lib/appsumo/expiry'
import { sendEmail } from '@/lib/email/send'
import {
  expiredEmail,
  renewalWarningEmail,
} from '@/lib/email/templates/appsumo'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * Resolve the public URL used in outbound emails. Prefer an explicit
 * APP_URL env var (so the cron service can be told exactly where the
 * app lives) and fall back to the request host as a last resort.
 */
function getAppUrl(request: NextRequest): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '')
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https'
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`
  return new URL(request.url).origin
}

interface RunSummary {
  ok: true
  warning: { processed: number; emailed: number; skipped: number; errors: number }
  expired: { processed: number; emailed: number; errors: number }
  ranAt: string
}

async function runSweep(request: NextRequest): Promise<RunSummary> {
  const admin = createAdminClient()
  const now = new Date()
  const appUrl = getAppUrl(request)
  const billingUrl = `${appUrl}/dashboard/billing`

  const summary: RunSummary = {
    ok: true,
    warning: { processed: 0, emailed: 0, skipped: 0, errors: 0 },
    expired: { processed: 0, emailed: 0, errors: 0 },
    ranAt: now.toISOString(),
  }

  // --- Pass 1: 30-day renewal warning ----------------------------------
  const warningSubs = await findSubsNeedingRenewalWarning(admin, now)
  for (const sub of warningSubs) {
    summary.warning.processed += 1
    const periodEndIso = sub.current_period_end
    try {
      const already = await hasAuditEntryFor(admin, {
        organizationId: sub.organization_id,
        action: AUDIT_ACTION_WARNING,
        subscriptionId: sub.id,
        periodEndIso,
      })
      if (already) {
        summary.warning.skipped += 1
        continue
      }

      const { email } = await resolveBillingEmail(admin, sub.organization_id)
      if (!email) {
        // No mailable user — still record so we don't spin on this
        // sub forever, with a marker so support can spot it.
        await recordAuditEntry(admin, {
          organizationId: sub.organization_id,
          action: AUDIT_ACTION_WARNING,
          subscriptionId: sub.id,
          periodEndIso,
          extra: { skipped_reason: 'no_billing_email' },
        })
        summary.warning.skipped += 1
        continue
      }

      const template = renewalWarningEmail({
        organizationName: sub.organizations?.name ?? 'your organization',
        periodEndIso,
        billingUrl,
      })
      const result = await sendEmail({
        to: email,
        subject: template.subject,
        text: template.text,
        html: template.html,
      })

      await recordAuditEntry(admin, {
        organizationId: sub.organization_id,
        action: AUDIT_ACTION_WARNING,
        subscriptionId: sub.id,
        periodEndIso,
        extra: {
          email_to: email,
          email_sent: result.sent,
          email_provider_id: result.providerMessageId ?? null,
          email_error: result.error ?? null,
          email_reason: result.reason ?? null,
        },
      })

      if (result.sent) summary.warning.emailed += 1
    } catch (err: any) {
      summary.warning.errors += 1
      console.error(
        `[cron/appsumo-expiry] warning failed for sub ${sub.id}:`,
        err
      )
    }
  }

  // --- Pass 2: expire lapsed subscriptions -----------------------------
  const expireSubs = await findSubsToExpire(admin, now)
  for (const sub of expireSubs) {
    summary.expired.processed += 1
    const periodEndIso = sub.current_period_end
    try {
      const already = await hasAuditEntryFor(admin, {
        organizationId: sub.organization_id,
        action: AUDIT_ACTION_EXPIRED,
        subscriptionId: sub.id,
        periodEndIso,
      })
      if (already) {
        // Already processed in a previous run — but the sub still has
        // plan='annual_appsumo' + status='active' somehow. Re-run the
        // downgrade defensively in case the previous run errored
        // after recording the audit entry.
        await expireSubscription(admin, sub.id, sub.organization_id)
        continue
      }

      // Downgrade first — even if the email fails we want the user off
      // the paid tier as of period_end.
      await expireSubscription(admin, sub.id, sub.organization_id)

      const { email } = await resolveBillingEmail(admin, sub.organization_id)
      let emailResult: { sent: boolean; providerMessageId?: string; error?: string; reason?: string } = {
        sent: false,
        reason: 'no_billing_email',
      }
      if (email) {
        const template = expiredEmail({
          organizationName: sub.organizations?.name ?? 'your organization',
          periodEndIso,
          billingUrl,
        })
        const sendRes = await sendEmail({
          to: email,
          subject: template.subject,
          text: template.text,
          html: template.html,
        })
        emailResult = {
          sent: sendRes.sent,
          providerMessageId: sendRes.providerMessageId,
          error: sendRes.error,
          reason: sendRes.reason,
        }
        if (sendRes.sent) summary.expired.emailed += 1
      }

      await recordAuditEntry(admin, {
        organizationId: sub.organization_id,
        action: AUDIT_ACTION_EXPIRED,
        subscriptionId: sub.id,
        periodEndIso,
        extra: {
          email_to: email,
          email_sent: emailResult.sent,
          email_provider_id: emailResult.providerMessageId ?? null,
          email_error: emailResult.error ?? null,
          email_reason: emailResult.reason ?? null,
        },
      })
    } catch (err: any) {
      summary.expired.errors += 1
      console.error(
        `[cron/appsumo-expiry] expire failed for sub ${sub.id}:`,
        err
      )
    }
  }

  return summary
}

function verifyCronAuth(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error(
      '[cron/appsumo-expiry] CRON_SECRET is not set — refusing to run'
    )
    return false
  }
  const auth = request.headers.get('authorization') || ''
  const provided = auth.replace(/^Bearer\s+/i, '').trim()
  if (!provided) return false
  // Constant-time compare to deter token-guessing timing attacks.
  if (provided.length !== secret.length) return false
  let mismatch = 0
  for (let i = 0; i < provided.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ secret.charCodeAt(i)
  }
  return mismatch === 0
}

export async function POST(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const summary = await runSweep(request)
    return NextResponse.json(summary)
  } catch (err: any) {
    console.error('[cron/appsumo-expiry] sweep failed:', err)
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'sweep failed' },
      { status: 500 }
    )
  }
}

// Some cron platforms only support GET. We allow it but require the
// same Bearer secret so an unauthenticated visitor can't trigger
// downgrades / emails by curling the URL.
export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const summary = await runSweep(request)
    return NextResponse.json(summary)
  } catch (err: any) {
    console.error('[cron/appsumo-expiry] sweep failed:', err)
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'sweep failed' },
      { status: 500 }
    )
  }
}
