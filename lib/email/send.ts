/**
 * Thin wrapper around Resend so the rest of the app doesn't have to
 * deal with provider-specific quirks (missing API key, error shape,
 * sandbox sender address). Mirrors the pattern used by the support
 * route, with a soft fallback for environments where RESEND_API_KEY
 * isn't configured (development, preview deploys) — in that case we
 * log the would-be email instead of throwing so cron jobs / webhooks
 * don't fail just because email isn't wired up locally.
 */

import { Resend } from 'resend'

const DEFAULT_FROM = 'Synra <hello@mcpserver.design>'
// Resend's shared sandbox sender — works without DNS setup, used as a
// fallback if the user hasn't verified their domain yet.
const SANDBOX_FROM = 'Synra <onboarding@resend.dev>'

let _client: Resend | null = null

function getClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null
  if (!_client) _client = new Resend(process.env.RESEND_API_KEY)
  return _client
}

export interface SendEmailInput {
  to: string
  subject: string
  text: string
  html?: string
  /**
   * Override the From address. Useful when calling from a flow that
   * legally requires a specific sender. Defaults to the configured
   * EMAIL_FROM env var, then DEFAULT_FROM, then the Resend sandbox.
   */
  from?: string
  replyTo?: string
}

export interface SendEmailResult {
  sent: boolean
  /**
   * Reason the email wasn't sent. Only populated when sent === false.
   * Cron / webhook callers should treat 'not_configured' as a soft
   * failure (don't retry, don't error out) and any other reason as
   * worth surfacing in audit logs.
   */
  reason?: 'not_configured' | 'provider_error'
  providerMessageId?: string
  error?: string
}

/**
 * Send a transactional email. Returns a structured result instead of
 * throwing so callers can log + carry on.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const client = getClient()
  if (!client) {
    console.log(
      `[email] RESEND_API_KEY not set — would have sent to=${input.to} subject=${JSON.stringify(input.subject)}`
    )
    return { sent: false, reason: 'not_configured' }
  }

  const from = input.from || process.env.EMAIL_FROM || DEFAULT_FROM
  try {
    const res = await client.emails.send({
      from,
      to: input.to,
      replyTo: input.replyTo,
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
    })

    if (res.error) {
      // If the configured sender is unverified, Resend returns a 403 —
      // retry once with the sandbox sender so dev / preview deploys
      // don't silently drop transactional mail.
      const msg = (res.error.message ?? '').toLowerCase()
      const looksLikeSenderProblem =
        msg.includes('domain') || msg.includes('verify') || msg.includes('from')
      if (looksLikeSenderProblem && from !== SANDBOX_FROM) {
        console.warn(
          `[email] sender ${from} rejected, retrying with sandbox sender:`,
          res.error.message
        )
        const retry = await client.emails.send({
          from: SANDBOX_FROM,
          to: input.to,
          replyTo: input.replyTo,
          subject: input.subject,
          text: input.text,
          ...(input.html ? { html: input.html } : {}),
        })
        if (retry.error) {
          return {
            sent: false,
            reason: 'provider_error',
            error: retry.error.message,
          }
        }
        return { sent: true, providerMessageId: retry.data?.id }
      }
      return {
        sent: false,
        reason: 'provider_error',
        error: res.error.message,
      }
    }
    return { sent: true, providerMessageId: res.data?.id }
  } catch (err: any) {
    return {
      sent: false,
      reason: 'provider_error',
      error: err?.message ?? String(err),
    }
  }
}
