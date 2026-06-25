'use client'

import { Suspense, useEffect, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginShell />}>
      <LoginPageInner />
    </Suspense>
  )
}

function LoginShell() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Synra</h1>
          <p className="text-sm text-gray-400">Managed MCP Gateway</p>
        </div>
        <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-8 h-64 animate-pulse" />
      </div>
    </div>
  )
}

function LoginPageInner() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [companySize, setCompanySize] = useState('')
  const [useCase, setUseCase] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState<
    'google' | 'linkedin_oidc' | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createBrowserClient()

  // Surface errors that the OAuth callback redirected back with.
  useEffect(() => {
    const callbackError = searchParams.get('error')
    if (callbackError) setError(callbackError)
  }, [searchParams])

  const handleOAuthSignIn = async (
    provider: 'google' | 'linkedin_oidc',
    providerLabel: string
  ) => {
    setError(null)
    setMessage(null)
    setOauthLoading(provider)
    try {
      const redirectParam = searchParams.get('redirect') || '/dashboard'
      // Google supports prompt/access_type query params; LinkedIn doesn't —
      // sending them would cause LinkedIn to reject the auth request.
      const queryParams =
        provider === 'google'
          ? { access_type: 'offline', prompt: 'select_account' }
          : undefined
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectParam)}`,
          ...(queryParams ? { queryParams } : {}),
        },
      })
      if (oauthError) throw oauthError
      // signInWithOAuth triggers a full-page redirect; if we reach this
      // line without an error, the redirect is in flight.
    } catch (err: any) {
      setError(err.message || `${providerLabel} sign-in failed`)
      setOauthLoading(null)
    }
  }

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    try {
      if (isSignUp) {
        // Sign up flow
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              name,
              company_name: companyName,
              company_size: companySize,
              use_case: useCase,
            },
          },
        })

        if (signUpError) throw signUpError

        if (data.user) {
          // Call API to create organization + user record + membership + subscription
          const response = await fetch('/api/auth/setup-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: data.user.id,
              email: data.user.email,
              name,
              companyName,
              companySize,
              useCase,
            }),
          })

          if (!response.ok) {
            const errorData = await response.json()
            throw new Error(errorData.error || 'Failed to set up user account')
          }

          // Check if email confirmation is required
          if (data.session) {
            // No email confirmation needed — go straight to dashboard
            setMessage('Account created! Redirecting to dashboard...')
            setTimeout(() => router.push('/dashboard'), 1500)
          } else {
            // Email confirmation required — tell user to check email
            setMessage('Account created! Please check your email to confirm your account, then sign in.')
          }
        }
      } else {
        // Login flow
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        if (signInError) throw signInError

        router.push('/dashboard')
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Synra</h1>
          <p className="text-sm text-gray-400">Managed MCP Gateway</p>
        </div>

        {/* Auth Card */}
        <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-8">
          <h2 className="text-2xl font-semibold text-white mb-6">
            {isSignUp ? 'Create Account' : 'Sign In'}
          </h2>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded text-sm text-red-400">
              {error}
            </div>
          )}

          {message && (
            <div className="mb-4 p-3 bg-green-500/10 border border-green-500/20 rounded text-sm text-green-400">
              {message}
            </div>
          )}

          <div className="space-y-2 mb-6">
            <button
              type="button"
              onClick={() => handleOAuthSignIn('google', 'Google')}
              disabled={oauthLoading !== null || loading}
              className="w-full flex items-center justify-center gap-3 py-2.5 px-4 bg-white hover:bg-gray-100 disabled:bg-gray-300 text-gray-800 font-medium rounded-md transition-all"
            >
              <svg className="w-5 h-5" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
                <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
                <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
                <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
              </svg>
              {oauthLoading === 'google' ? 'Redirecting…' : 'Continue with Google'}
            </button>

            <button
              type="button"
              onClick={() => handleOAuthSignIn('linkedin_oidc', 'LinkedIn')}
              disabled={oauthLoading !== null || loading}
              className="w-full flex items-center justify-center gap-3 py-2.5 px-4 bg-[#0A66C2] hover:bg-[#0958a8] disabled:bg-[#0a66c280] text-white font-medium rounded-md transition-all"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.063 2.063 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
              {oauthLoading === 'linkedin_oidc' ? 'Redirecting…' : 'Continue with LinkedIn'}
            </button>
          </div>

          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-[#1c1c1c]" />
            <span className="text-xs text-gray-600 uppercase tracking-wider">or</span>
            <div className="flex-1 h-px bg-[#1c1c1c]" />
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            {isSignUp && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="w-full px-4 py-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md text-white focus:border-blue-500 focus:outline-none"
                    placeholder="Your name"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Company Name
                  </label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    required
                    className="w-full px-4 py-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md text-white focus:border-blue-500 focus:outline-none"
                    placeholder="Your company or project name"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Company Size
                  </label>
                  <select
                    value={companySize}
                    onChange={(e) => setCompanySize(e.target.value)}
                    required
                    className="w-full px-4 py-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md text-white focus:border-blue-500 focus:outline-none appearance-none"
                  >
                    <option value="" disabled>Select team size</option>
                    <option value="solo">Solo / Freelancer</option>
                    <option value="2-10">2–10 employees</option>
                    <option value="11-50">11–50 employees</option>
                    <option value="51-200">51–200 employees</option>
                    <option value="201-1000">201–1,000 employees</option>
                    <option value="1000+">1,000+ employees</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    What do you want to connect to AI?
                  </label>
                  <input
                    type="text"
                    value={useCase}
                    onChange={(e) => setUseCase(e.target.value)}
                    className="w-full px-4 py-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md text-white focus:border-blue-500 focus:outline-none"
                    placeholder="e.g. Supabase, PostgreSQL, MySQL, Stripe, Shopify"
                  />
                  <p className="text-[11px] text-gray-600 mt-1">
                    Separate with commas. Helps us prioritize connectors.
                  </p>
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-4 py-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md text-white focus:border-blue-500 focus:outline-none"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="current-password"
                className="w-full px-4 py-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md text-white focus:border-blue-500 focus:outline-none"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-gray-600 disabled:to-gray-700 text-white font-medium rounded-md transition-all"
            >
              {loading ? 'Loading...' : isSignUp ? 'Create Account' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => {
                setIsSignUp(!isSignUp)
                setError(null)
                setMessage(null)
              }}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              {isSignUp
                ? 'Already have an account? Sign in'
                : "Don't have an account? Sign up"}
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-gray-500 mt-6">
          By signing up, you agree to our Terms of Service and Privacy Policy
        </p>
      </div>
    </div>
  )
}
