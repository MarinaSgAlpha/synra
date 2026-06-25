/**
 * OAuth callback — Supabase redirects users here after they complete the
 * provider's consent flow (Google, etc.). We exchange the `code` for a
 * session, set the session cookie on the redirect response, and call our
 * idempotent setup-user API so first-time OAuth users get an org + user
 * + membership + subscription row just like password sign-ups do.
 */

import { createServerClient as createSSRClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Resolve the user-facing public origin (e.g. "https://app.mcpserver.design")
 * even when Next.js sees the request via a reverse proxy that injects the
 * internal hostname (Railway uses localhost:8080 internally).
 *
 * Precedence:
 *   1. x-forwarded-host + x-forwarded-proto (set by every modern proxy)
 *   2. Host header (set by the browser, usually correct on direct hits)
 *   3. request.url's origin (fallback for unproxied / dev environments)
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
  // Public origin for browser-bound redirects (must be the URL the user sees).
  const publicOrigin = getPublicOrigin(request)
  // Internal origin for same-container fetches (Railway: localhost:8080 — fast,
  // avoids a wasteful round-trip out to the public internet and back).
  const internalOrigin = new URL(request.url).origin
  const code = searchParams.get('code')
  const next = searchParams.get('next') || '/dashboard'
  const errorParam = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  // Provider-side error (e.g. user denied consent).
  if (errorParam) {
    const url = new URL('/login', publicOrigin)
    url.searchParams.set('error', errorDescription || errorParam)
    return NextResponse.redirect(url)
  }

  if (!code) {
    const url = new URL('/login', publicOrigin)
    url.searchParams.set('error', 'Missing authorization code')
    return NextResponse.redirect(url)
  }

  // Tie the Supabase client to the request's cookie store so
  // exchangeCodeForSession's `setAll` actually writes the auth cookies
  // onto the response that we'll return at the end.
  const cookieStore = await cookies()
  const supabase = createSSRClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.session) {
    const url = new URL('/login', publicOrigin)
    url.searchParams.set(
      'error',
      error?.message || 'Failed to complete sign-in'
    )
    return NextResponse.redirect(url)
  }

  // First-time OAuth users won't have an org / user / membership row yet.
  // setup-user is idempotent (returns "already set up" if the row exists)
  // so it's safe to call on every sign-in.
  const user = data.session.user
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>
  const name =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    (user.email ? user.email.split('@')[0] : 'User')

  try {
    const setupRes = await fetch(
      new URL('/api/auth/setup-user', internalOrigin).toString(),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          email: user.email,
          name,
        }),
      }
    )
    if (!setupRes.ok) {
      const detail = await setupRes.text().catch(() => '')
      console.error(
        `[auth/callback] setup-user returned ${setupRes.status}: ${detail}`
      )
    }
  } catch (err) {
    // Don't block sign-in if setup-user is briefly unavailable;
    // surface in logs and continue. The next sign-in will retry.
    console.error('[auth/callback] setup-user call failed', err)
  }

  return NextResponse.redirect(new URL(next, publicOrigin))
}
