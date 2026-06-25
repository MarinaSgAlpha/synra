'use client'

/**
 * AppSumo redemption landing page.
 *
 * AppSumo redirects the customer to /api/appsumo/oauth/redirect, which
 * stashes the single-use `code` in an HttpOnly cookie and bounces them
 * here. From the customer's POV this is the post-purchase "activate
 * your lifetime deal on Synra" page.
 *
 * Flow:
 *   - If the user is NOT signed in → prompt them to log in or sign up.
 *     The cookie persists across the auth flow (10-minute TTL) and we
 *     return them here via ?redirect=/appsumo/redeem.
 *   - If the user IS signed in → POST to /api/appsumo/redeem, which
 *     exchanges the code, fetches the license, and links it to their
 *     organization. Then bounce to /dashboard.
 */

import { createBrowserClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'

type Status = 'checking' | 'needs_login' | 'redeeming' | 'success' | 'error'

export default function AppsumoRedeemPage() {
  return (
    <Suspense fallback={<RedeemShell heading="Loading…" />}>
      <AppsumoRedeemInner />
    </Suspense>
  )
}

function AppsumoRedeemInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createBrowserClient()
  const [status, setStatus] = useState<Status>('checking')
  const [message, setMessage] = useState<string | null>(null)
  const [alreadyLinked, setAlreadyLinked] = useState(false)

  useEffect(() => {
    // Surface any error AppSumo passed in via the OAuth redirect.
    const providerError = searchParams.get('error')
    if (providerError) {
      setStatus('error')
      setMessage(providerError)
      return
    }

    let cancelled = false

    async function run() {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (cancelled) return

      if (!user) {
        setStatus('needs_login')
        return
      }

      setStatus('redeeming')
      try {
        const res = await fetch('/api/appsumo/redeem', {
          method: 'POST',
          credentials: 'include',
        })
        const data = await res.json().catch(() => ({}))

        if (cancelled) return

        if (!res.ok) {
          setStatus('error')
          setMessage(data?.error ?? `Redemption failed (HTTP ${res.status})`)
          return
        }

        setAlreadyLinked(Boolean(data?.alreadyLinked))
        setStatus('success')

        // Send them to the dashboard so they can use what they bought.
        setTimeout(() => router.push('/dashboard'), 2200)
      } catch (err: any) {
        if (cancelled) return
        setStatus('error')
        setMessage(err?.message ?? 'Unexpected error during redemption.')
      }
    }

    run()

    return () => {
      cancelled = true
    }
  }, [router, searchParams, supabase])

  if (status === 'checking' || status === 'redeeming') {
    return (
      <RedeemShell
        heading="Activating your AppSumo lifetime deal…"
        body="Hang tight — this usually takes a couple of seconds."
        spinner
      />
    )
  }

  if (status === 'needs_login') {
    return (
      <RedeemShell heading="One step to activate your lifetime deal">
        <p className="text-sm text-gray-400">
          Sign in (or create an account) and we&apos;ll instantly link your
          AppSumo license to your Synra organization.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Link
            href="/login?redirect=/appsumo/redeem"
            className="w-full py-2.5 bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-medium rounded-md text-center transition-all"
          >
            Sign in
          </Link>
          <Link
            href="/login?redirect=/appsumo/redeem&signup=1"
            className="w-full py-2.5 bg-[#1c1c1c] hover:bg-[#262626] text-white font-medium rounded-md text-center transition-all"
          >
            Create an account
          </Link>
        </div>
        <p className="text-[11px] text-gray-600 mt-4">
          Your activation code is held securely for 10 minutes. If it expires,
          just click &quot;Activate&quot; on AppSumo again.
        </p>
      </RedeemShell>
    )
  }

  if (status === 'success') {
    return (
      <RedeemShell heading="You&apos;re all set">
        <p className="text-sm text-gray-300">
          {alreadyLinked
            ? 'This license was already active on your organization.'
            : 'Your lifetime deal is now active on your Synra organization.'}
        </p>
        <p className="text-xs text-gray-500 mt-3">
          Redirecting you to your dashboard…
        </p>
      </RedeemShell>
    )
  }

  return (
    <RedeemShell heading="We hit a snag activating your license">
      <p className="text-sm text-red-400">
        {message ?? 'Unknown error during redemption.'}
      </p>
      <p className="text-xs text-gray-500 mt-3">
        Try clicking &quot;Activate&quot; again from AppSumo, or contact{' '}
        <a className="underline" href="mailto:support@mcpserver.design">
          support@mcpserver.design
        </a>{' '}
        with the message above.
      </p>
    </RedeemShell>
  )
}

interface RedeemShellProps {
  heading: string
  body?: string
  spinner?: boolean
  children?: React.ReactNode
}

function RedeemShell({ heading, body, spinner, children }: RedeemShellProps) {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Synra</h1>
          <p className="text-sm text-gray-400">AppSumo lifetime activation</p>
        </div>
        <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-8">
          <h2 className="text-xl font-semibold text-white">{heading}</h2>
          {body && <p className="text-sm text-gray-400 mt-3">{body}</p>}
          {spinner && (
            <div className="mt-6 h-1 w-full bg-[#1c1c1c] overflow-hidden rounded">
              <div className="h-full w-1/3 bg-blue-500 animate-pulse" />
            </div>
          )}
          {children && <div className="mt-2">{children}</div>}
        </div>
      </div>
    </div>
  )
}
