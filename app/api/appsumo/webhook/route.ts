/**
 * AppSumo Licensing webhook receiver.
 *
 *   GET  /api/appsumo/webhook   — health / pre-validation. Returns 200 OK.
 *                                 (AppSumo doesn't actually GET this, but
 *                                 it's useful as a manual liveness probe.)
 *
 *   POST /api/appsumo/webhook   — receives `purchase`, `activate`,
 *                                 `upgrade`, `downgrade`, `migrate`,
 *                                 `deactivate`, and test (`test: true`)
 *                                 events from AppSumo.
 *
 * MUST always respond with `{ event, success: true }` and HTTP 200 —
 * AppSumo treats any other status (including 201 / 204) as a delivery
 * failure and will retry. We respond OK even on internal processing
 * errors *for test events* so URL validation doesn't fail because of a
 * bug in our handler.
 *
 * Docs: https://docs.licensing.appsumo.com/webhook/
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { getAppsumoConfig } from '@/lib/appsumo/config'
import { deactivateLicense } from '@/lib/appsumo/redeem'
import {
  APPSUMO_SIGNATURE_HEADER,
  APPSUMO_TIMESTAMP_HEADER,
  verifyAppsumoSignature,
} from '@/lib/appsumo/signature'
import type { SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// Force Node runtime — we need crypto for HMAC and don't want body
// transformations from the edge runtime.
export const runtime = 'nodejs'

interface AppsumoWebhookBody {
  event: 'purchase' | 'activate' | 'upgrade' | 'downgrade' | 'migrate' | 'deactivate' | string
  license_key: string
  prev_license_key?: string
  parent_license_key?: string
  partner_plan_name?: string
  tier?: number
  unit_quantity?: number
  license_status?: 'active' | 'inactive' | 'deactivated' | string
  event_timestamp?: number
  created_at?: number
  test?: boolean
  extra?: { reason?: string } & Record<string, unknown>
}

function successResponse(event: string, message?: string) {
  return NextResponse.json({
    event,
    success: true,
    ...(message ? { message } : {}),
  })
}

export async function GET() {
  // AppSumo's webhook validation is POST-based, but a 200 here is handy
  // for manual liveness checks and doesn't hurt.
  return NextResponse.json({ ok: true, service: 'appsumo-webhook' })
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get(APPSUMO_SIGNATURE_HEADER)
  const timestamp = request.headers.get(APPSUMO_TIMESTAMP_HEADER)

  let body: AppsumoWebhookBody
  try {
    body = JSON.parse(rawBody) as AppsumoWebhookBody
  } catch (err: any) {
    console.error('[appsumo/webhook] non-JSON body:', err.message, rawBody.slice(0, 200))
    return NextResponse.json(
      { event: 'unknown', success: false, error: 'invalid JSON body' },
      { status: 400 }
    )
  }

  const event = body.event ?? 'unknown'
  const isTest = body.test === true

  // Verify the HMAC signature using our configured API key. We skip
  // verification for test events because the Partner Portal's
  // pre-save validation traffic isn't signed in a way we can rely on
  // and we don't want a missing env var to block URL registration.
  if (!isTest) {
    let apiKey: string
    try {
      apiKey = getAppsumoConfig().apiKey
    } catch (err: any) {
      console.error('[appsumo/webhook] config error:', err.message)
      return NextResponse.json(
        { event, success: false, error: 'webhook not configured' },
        { status: 500 }
      )
    }

    const verification = verifyAppsumoSignature(rawBody, signature, timestamp, apiKey)
    if (!verification.valid) {
      console.warn(
        `[appsumo/webhook] signature verification failed for event=${event}: ${verification.reason}`
      )
      return NextResponse.json(
        { event, success: false, error: 'invalid signature' },
        { status: 401 }
      )
    }
  }

  const admin = createAdminClient()

  // Idempotency: log every event into webhook_events. AppSumo doesn't
  // give us a stable event_id, so we synthesize one from license_key +
  // event + event_timestamp (which is per-attempt; retries reuse it).
  const eventId = [
    'appsumo',
    body.license_key,
    event,
    body.event_timestamp ?? Date.now(),
  ].join(':')

  await admin
    .from('webhook_events')
    .insert({
      source: 'appsumo',
      event_type: event,
      event_id: eventId,
      payload: body as unknown as Record<string, unknown>,
      processed: false,
    })
    // Duplicate event_id (retry of a previously-logged event) — fine,
    // continue processing for at-least-once semantics on the side
    // effects (which are themselves idempotent).
    .then(() => {})

  // Test events: log, respond OK, don't mutate anything.
  if (isTest) {
    console.log(`[appsumo/webhook] test event received: ${event}`)
    await admin
      .from('webhook_events')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('event_id', eventId)
    return successResponse(event, 'test acknowledged')
  }

  try {
    switch (event) {
      case 'purchase':
        await handlePurchase(admin, body)
        break
      case 'activate':
        await handleActivate(admin, body)
        break
      case 'upgrade':
      case 'downgrade':
        await handleUpgradeOrDowngrade(admin, body)
        break
      case 'migrate':
        await handleMigrate(admin, body)
        break
      case 'deactivate':
        await handleDeactivate(admin, body)
        break
      default:
        console.warn(`[appsumo/webhook] unhandled event type: ${event}`)
    }

    await admin
      .from('webhook_events')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('event_id', eventId)

    return successResponse(event)
  } catch (err: any) {
    console.error(`[appsumo/webhook] processing error for ${event}:`, err)
    await admin
      .from('webhook_events')
      .update({ error_message: err.message ?? String(err) })
      .eq('event_id', eventId)

    // Return a non-200 so AppSumo will retry. We never want to drop
    // a real purchase / deactivate silently.
    return NextResponse.json(
      { event, success: false, error: err.message ?? 'processing error' },
      { status: 500 }
    )
  }
}

/**
 * Purchase: AppSumo has issued a license but the user hasn't completed
 * OAuth yet. We pre-create an `appsumo_codes` row in 'purchased' state
 * so that (a) the support team can see the license exists and (b) the
 * OAuth redemption path can find it later.
 */
async function handlePurchase(admin: SupabaseClient, body: AppsumoWebhookBody) {
  const { error } = await admin.from('appsumo_codes').upsert(
    {
      license_key: body.license_key,
      parent_license_key: body.parent_license_key ?? null,
      partner_plan_name: body.partner_plan_name ?? null,
      tier: body.tier ?? null,
      unit_quantity: body.unit_quantity ?? null,
      status: 'purchased' as const,
      last_event: 'purchase',
      last_payload: body as unknown as Record<string, unknown>,
    },
    { onConflict: 'license_key', ignoreDuplicates: false }
  )
  if (error) throw new Error(`purchase upsert failed: ${error.message}`)
}

/**
 * Activate: AppSumo confirms the user has clicked "Activate". Most of
 * the actual work happens in /api/appsumo/redeem (OAuth flow), so here
 * we just stamp the row as activated if it isn't already.
 *
 * Note: license_status will be "inactive" in the payload — that's
 * normal. AppSumo only flips it active on their side after our 200.
 */
async function handleActivate(admin: SupabaseClient, body: AppsumoWebhookBody) {
  const { data: existing } = await admin
    .from('appsumo_codes')
    .select('id, status, organization_id')
    .eq('license_key', body.license_key)
    .maybeSingle()

  // Don't downgrade a 'deactivated' code back to 'activated' just
  // because a stale webhook arrived.
  const nextStatus =
    existing?.status === 'deactivated' ? 'deactivated' : 'activated'

  const { error } = await admin.from('appsumo_codes').upsert(
    {
      license_key: body.license_key,
      parent_license_key: body.parent_license_key ?? null,
      partner_plan_name: body.partner_plan_name ?? null,
      tier: body.tier ?? null,
      unit_quantity: body.unit_quantity ?? null,
      status: nextStatus,
      activated_at:
        existing?.status === 'activated'
          ? undefined
          : new Date().toISOString(),
      last_event: 'activate',
      last_payload: body as unknown as Record<string, unknown>,
    },
    { onConflict: 'license_key' }
  )
  if (error) throw new Error(`activate upsert failed: ${error.message}`)
}

/**
 * Upgrade / Downgrade: AppSumo issues a brand-new license_key for the
 * customer's new tier and (separately) deactivates the old key. We
 * carry the existing organization linkage from the old key to the
 * new one so the user doesn't get bumped off their plan mid-upgrade.
 *
 * The plan stays `lifetime_appsumo` either way — we don't tier-gate
 * lifetime features today. Tier is stored on appsumo_codes for support.
 */
async function handleUpgradeOrDowngrade(
  admin: SupabaseClient,
  body: AppsumoWebhookBody
) {
  let organizationId: string | null = null
  let redeemedByUserId: string | null = null

  if (body.prev_license_key) {
    const { data: prev } = await admin
      .from('appsumo_codes')
      .select('organization_id, redeemed_by_user_id')
      .eq('license_key', body.prev_license_key)
      .maybeSingle()
    organizationId = prev?.organization_id ?? null
    redeemedByUserId = prev?.redeemed_by_user_id ?? null
  }

  const isUpgrade = body.event === 'upgrade'

  const { error } = await admin.from('appsumo_codes').upsert(
    {
      license_key: body.license_key,
      prev_license_key: body.prev_license_key ?? null,
      parent_license_key: body.parent_license_key ?? null,
      partner_plan_name: body.partner_plan_name ?? null,
      tier: body.tier ?? null,
      unit_quantity: body.unit_quantity ?? null,
      organization_id: organizationId,
      redeemed_by_user_id: redeemedByUserId,
      status: organizationId
        ? ('activated' as const)
        : ('purchased' as const),
      activated_at: organizationId ? new Date().toISOString() : null,
      last_event: isUpgrade ? 'upgrade' : 'downgrade',
      last_payload: body as unknown as Record<string, unknown>,
    },
    { onConflict: 'license_key' }
  )
  if (error) {
    throw new Error(`${body.event} upsert failed: ${error.message}`)
  }

  // The simultaneous `deactivate` event for prev_license_key arrives
  // as a separate webhook call, so we don't mark the old key here.
}

/**
 * Migrate: add-on-specific ledger record fired during parent upgrade /
 * downgrade. The add-on's own license_key doesn't change; only its
 * parent_license_key updates. We persist the new parent linkage so
 * future lookups are coherent.
 */
async function handleMigrate(admin: SupabaseClient, body: AppsumoWebhookBody) {
  const { error } = await admin.from('appsumo_codes').upsert(
    {
      license_key: body.license_key,
      parent_license_key: body.parent_license_key ?? null,
      partner_plan_name: body.partner_plan_name ?? null,
      tier: body.tier ?? null,
      unit_quantity: body.unit_quantity ?? null,
      last_event: 'migrate',
      last_payload: body as unknown as Record<string, unknown>,
    },
    { onConflict: 'license_key' }
  )
  if (error) throw new Error(`migrate upsert failed: ${error.message}`)
}

/**
 * Deactivate: refund, cancellation, or staff revoke. Mark the code
 * deactivated and (if it was linked to an org) flip that org back to
 * the free plan. The OAuth-side deactivation is what actually kicks
 * the user off lifetime features.
 *
 * Note: license_status will be "active" in the payload — that's normal,
 * AppSumo flips it on their side only after our 200.
 */
async function handleDeactivate(admin: SupabaseClient, body: AppsumoWebhookBody) {
  const result = await deactivateLicense(
    admin,
    body.license_key,
    body as unknown as Record<string, unknown>
  )
  if (result.organizationId) {
    console.log(
      `[appsumo/webhook] deactivated license ${body.license_key} → downgraded org ${result.organizationId} to free`
    )
  } else {
    console.log(
      `[appsumo/webhook] deactivated license ${body.license_key} (no org linkage)`
    )
  }
}
