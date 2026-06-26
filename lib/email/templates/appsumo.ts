/**
 * Transactional email templates for the AppSumo annual expiry flow.
 *
 *   renewalWarningEmail   — sent ~30 days before current_period_end
 *   expiredEmail          — sent on the day the period ends, after the
 *                           cron has flipped the org back to free
 *
 * Both link to /dashboard/billing where the existing Stripe Starter
 * ($19/mo) checkout button lives. We don't deep-link straight into
 * Stripe so the user has a chance to read the in-app context first
 * (and so we don't have to hold a one-shot Stripe session URL across
 * a several-day email lifetime).
 */

export interface RenewalEmailContext {
  organizationName: string
  /** ISO date string. Formatted for the user inside the template. */
  periodEndIso: string
  /** Absolute URL to the billing page, e.g. https://app.mcpserver.design/dashboard/billing */
  billingUrl: string
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}

export function renewalWarningEmail(ctx: RenewalEmailContext): {
  subject: string
  text: string
  html: string
} {
  const expiresOn = formatDate(ctx.periodEndIso)
  const subject = `Your Synra AppSumo plan renews on ${expiresOn}`
  const text = `Hi there,

Your AppSumo annual plan for ${ctx.organizationName} on Synra expires on ${expiresOn} (about 30 days away).

To keep your connections and endpoints active beyond that date, you have two options:

1. Renew through AppSumo (if AppSumo offers a renewal on your deal)
2. Switch to Synra's monthly Starter plan at $19/month: ${ctx.billingUrl}

If you do nothing, your organization will automatically downgrade to the free plan on ${expiresOn}. Your data and connections stay in place — they just won't be able to handle requests over the free tier limits until you upgrade again.

Questions or want a custom plan? Reply to this email.

— The Synra team`

  const html = `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color:#111; max-width:560px; margin:0 auto; padding:24px; line-height:1.55;">
<h2 style="margin:0 0 16px; font-size:20px;">Your AppSumo plan renews soon</h2>
<p>Hi there,</p>
<p>Your AppSumo annual plan for <strong>${ctx.organizationName}</strong> on Synra expires on <strong>${expiresOn}</strong> (about 30 days away).</p>
<p>To keep your connections and endpoints active beyond that date, you have two options:</p>
<ol>
  <li>Renew through AppSumo (if AppSumo offers a renewal on your deal).</li>
  <li>Switch to Synra's monthly Starter plan at $19/month.</li>
</ol>
<p style="text-align:center; margin:28px 0;">
  <a href="${ctx.billingUrl}" style="display:inline-block; background:#2563eb; color:#fff; padding:12px 22px; border-radius:6px; text-decoration:none; font-weight:600;">Renew via Stripe ($19/mo)</a>
</p>
<p>If you do nothing, your organization will automatically downgrade to the free plan on ${expiresOn}. Your data and connections stay in place — they just won't be able to handle requests over the free tier limits until you upgrade again.</p>
<p>Questions or want a custom plan? Just reply to this email.</p>
<p style="color:#6b7280; font-size:13px; margin-top:32px;">— The Synra team</p>
</body></html>`

  return { subject, text, html }
}

export function expiredEmail(ctx: RenewalEmailContext): {
  subject: string
  text: string
  html: string
} {
  const expiredOn = formatDate(ctx.periodEndIso)
  const subject = `Your Synra AppSumo plan expired today`
  const text = `Hi there,

Your AppSumo annual plan for ${ctx.organizationName} on Synra expired today (${expiredOn}). The organization has been moved to the free plan.

Your data, connections, and endpoints are all still here — nothing was deleted. You're just on the free tier's request limits until you renew.

To resume full access, upgrade to Synra Starter at $19/month: ${ctx.billingUrl}

If AppSumo offers a renewal on your deal, you can re-redeem it instead and we'll restore your annual access immediately.

Questions? Reply to this email.

— The Synra team`

  const html = `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color:#111; max-width:560px; margin:0 auto; padding:24px; line-height:1.55;">
<h2 style="margin:0 0 16px; font-size:20px;">Your AppSumo plan expired today</h2>
<p>Hi there,</p>
<p>Your AppSumo annual plan for <strong>${ctx.organizationName}</strong> on Synra expired today (<strong>${expiredOn}</strong>). The organization has been moved to the free plan.</p>
<p>Your data, connections, and endpoints are all still here — nothing was deleted. You're just on the free tier's request limits until you renew.</p>
<p style="text-align:center; margin:28px 0;">
  <a href="${ctx.billingUrl}" style="display:inline-block; background:#2563eb; color:#fff; padding:12px 22px; border-radius:6px; text-decoration:none; font-weight:600;">Resume access — $19/mo</a>
</p>
<p>If AppSumo offers a renewal on your deal, you can re-redeem it instead and we'll restore your annual access immediately.</p>
<p>Questions? Just reply to this email.</p>
<p style="color:#6b7280; font-size:13px; margin-top:32px;">— The Synra team</p>
</body></html>`

  return { subject, text, html }
}
