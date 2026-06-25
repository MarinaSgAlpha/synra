/**
 * Complete an AppSumo redemption for the currently signed-in user.
 *
 *   POST /api/appsumo/redeem
 *
 * Reads the single-use OAuth `code` from the `appsumo_oauth_code` cookie
 * (set by /api/appsumo/oauth/redirect), exchanges it for an access token,
 * fetches the user's license_key, and links that license to the
 * authenticated user's organization — flipping the org to the
 * `lifetime_appsumo` plan.
 *
 * Refuses if:
 *   - user is not signed in (caller should show a login prompt)
 *   - no cookie (caller should send the user back to AppSumo to retry)
 *   - license is `deactivated` on AppSumo's side (refund/revoke)
 *   - license is already linked to a *different* org (one-time use)
 */

import { exchangeCodeForToken, fetchLicenseForToken } from '@/lib/appsumo/api'
import {
  APPSUMO_CODE_COOKIE,
  getAppsumoConfig,
} from '@/lib/appsumo/config'
import { linkLicenseToOrganization } from '@/lib/appsumo/redeem'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(_request: NextRequest) {
  const cookieStore = await cookies()
  const code = cookieStore.get(APPSUMO_CODE_COOKIE)?.value

  if (!code) {
    return NextResponse.json(
      {
        error:
          'No AppSumo activation code found. Please restart the activation from AppSumo.',
      },
      { status: 400 }
    )
  }

  // Identify the user from the Supabase session cookie.
  const ssr = await createServerClient()
  const {
    data: { user },
    error: authError,
  } = await ssr.auth.getUser()

  if (authError || !user) {
    return NextResponse.json(
      { error: 'You must be signed in to redeem an AppSumo license.' },
      { status: 401 }
    )
  }

  let config
  try {
    config = getAppsumoConfig()
  } catch (err: any) {
    console.error('[appsumo/redeem] config error:', err.message)
    return NextResponse.json(
      { error: 'AppSumo redemption is not configured on this server.' },
      { status: 500 }
    )
  }

  // Step 1: exchange the code for an access_token.
  let token
  try {
    token = await exchangeCodeForToken(code, config)
  } catch (err: any) {
    console.error('[appsumo/redeem] token exchange failed:', err)
    // Burn the cookie — the code is single-use and just got rejected.
    const res = NextResponse.json(
      {
        error:
          'Could not exchange the AppSumo activation code. Please restart the activation from AppSumo.',
      },
      { status: 400 }
    )
    res.cookies.delete(APPSUMO_CODE_COOKIE)
    return res
  }

  // Step 2: fetch the license_key + current status.
  let license
  try {
    license = await fetchLicenseForToken(token.access_token)
  } catch (err: any) {
    console.error('[appsumo/redeem] license fetch failed:', err)
    return NextResponse.json(
      { error: 'Could not fetch your license from AppSumo. Please try again.' },
      { status: 502 }
    )
  }

  if (license.status === 'deactivated') {
    return NextResponse.json(
      {
        error:
          'This AppSumo license has been deactivated (refunded or revoked). It cannot be redeemed.',
      },
      { status: 400 }
    )
  }

  // Step 3: find the user's organization (they're the owner of their
  // own org from signup). If they have multiple memberships we pick the
  // one where they are owner.
  const admin = createAdminClient()
  const { data: memberships, error: memberError } = await admin
    .from('organization_members')
    .select('organization_id, role')
    .eq('user_id', user.id)
    .eq('status', 'active')

  if (memberError) {
    console.error('[appsumo/redeem] membership lookup failed:', memberError)
    return NextResponse.json(
      { error: 'Could not load your organization. Please try again.' },
      { status: 500 }
    )
  }

  const ownerMembership = memberships?.find((m) => m.role === 'owner')
  const targetOrgId = (ownerMembership ?? memberships?.[0])?.organization_id

  if (!targetOrgId) {
    return NextResponse.json(
      {
        error:
          'No organization found for your account. Finish account setup, then retry the activation.',
      },
      { status: 400 }
    )
  }

  // Step 4: link license → org and upgrade the plan.
  try {
    const result = await linkLicenseToOrganization(admin, {
      licenseKey: license.license_key,
      organizationId: targetOrgId,
      userId: user.id,
      payload: license as unknown as Record<string, unknown>,
    })

    // Always burn the cookie on a terminal outcome.
    const responseInit = (status: number, body: unknown) => {
      const res = NextResponse.json(body, { status })
      res.cookies.delete(APPSUMO_CODE_COOKIE)
      return res
    }

    if (!result.ok) {
      if (result.reason === 'already_redeemed') {
        return responseInit(409, {
          error:
            'This AppSumo license has already been activated by a different account.',
        })
      }
      if (result.reason === 'license_deactivated') {
        return responseInit(400, {
          error: 'This AppSumo license has been deactivated and cannot be redeemed.',
        })
      }
      return responseInit(500, { error: 'Could not link the license.' })
    }

    console.log(
      `[appsumo/redeem] linked license ${license.license_key} → org ${result.organizationId}` +
        (result.alreadyLinkedToSameOrg ? ' (already linked)' : '')
    )

    return responseInit(200, {
      success: true,
      organizationId: result.organizationId,
      alreadyLinked: result.alreadyLinkedToSameOrg ?? false,
    })
  } catch (err: any) {
    console.error('[appsumo/redeem] link failed:', err)
    return NextResponse.json(
      { error: err.message ?? 'Failed to complete redemption.' },
      { status: 500 }
    )
  }
}
