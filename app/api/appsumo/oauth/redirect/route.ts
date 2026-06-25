/**
 * AppSumo OAuth redirect URL.
 *
 * Two responsibilities:
 *
 *   1. Pre-validation: the AppSumo Partner Portal hits this URL with a
 *      bare GET (no `code` query param) to confirm it returns 200 OK
 *      before saving the URL. Return 200 with a tiny body.
 *
 *   2. Real redemption: after the customer completes consent on AppSumo,
 *      they're redirected here with a single-use `?code=...`. We stash
 *      that code in a short-lived HttpOnly cookie and bounce them into
 *      /appsumo/redeem, which handles login / signup and then calls
 *      /api/appsumo/redeem to exchange the code and link the license.
 *
 *      We deliberately do NOT exchange the code here — the user might
 *      not be logged into Synra yet, and the code is single-use, so we
 *      can't burn it before knowing which org to link it to.
 *
 * Docs: https://docs.licensing.appsumo.com/licensing/licensing__connect.html
 */

import {
  APPSUMO_CODE_COOKIE,
  APPSUMO_CODE_COOKIE_MAX_AGE_SECONDS,
} from '@/lib/appsumo/config'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * Resolve the user-facing public origin from forwarded headers — the
 * same helper logic we use in /auth/callback, inlined here to avoid a
 * cross-route import.
 */
function getPublicOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto')
  if (forwardedHost) {
    const proto =
      forwardedProto ||
      (forwardedHost.startsWith('localhost') ? 'http' : 'https')
    return `${proto}://${forwardedHost}`
  }
  const host = request.headers.get('host')
  if (host && !host.startsWith('localhost')) {
    const proto = forwardedProto || 'https'
    return `${proto}://${host}`
  }
  return new URL(request.url).origin
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const errorParam = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  // AppSumo Partner Portal pre-save check.
  if (!code && !errorParam) {
    return NextResponse.json({
      ok: true,
      service: 'appsumo-oauth-redirect',
    })
  }

  const publicOrigin = getPublicOrigin(request)

  // Provider-side error — bounce to redeem page with a readable message.
  if (errorParam) {
    const url = new URL('/appsumo/redeem', publicOrigin)
    url.searchParams.set('error', errorDescription || errorParam)
    return NextResponse.redirect(url)
  }

  // Stash the single-use code in an HttpOnly cookie that only the
  // server-side redeem API will read. Short TTL — long enough to
  // cover a signup with email confirmation, short enough that a
  // forgotten code expires safely.
  const response = NextResponse.redirect(
    new URL('/appsumo/redeem', publicOrigin)
  )
  response.cookies.set(APPSUMO_CODE_COOKIE, code!, {
    httpOnly: true,
    secure: !publicOrigin.startsWith('http://localhost'),
    sameSite: 'lax',
    path: '/',
    maxAge: APPSUMO_CODE_COOKIE_MAX_AGE_SECONDS,
  })
  return response
}
