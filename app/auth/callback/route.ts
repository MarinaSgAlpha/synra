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

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') || '/dashboard'
  const errorParam = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  // Provider-side error (e.g. user denied consent).
  if (errorParam) {
    const url = new URL('/login', origin)
    url.searchParams.set('error', errorDescription || errorParam)
    return NextResponse.redirect(url)
  }

  if (!code) {
    const url = new URL('/login', origin)
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
    const url = new URL('/login', origin)
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
      new URL('/api/auth/setup-user', origin).toString(),
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

  return NextResponse.redirect(new URL(next, origin))
}
