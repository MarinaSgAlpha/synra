'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'
import {
  COMPANY_SIZES,
  INDUSTRIES,
  REFERRAL_SOURCES,
} from '@/lib/onboarding-options'

export default function OnboardingPage() {
  const router = useRouter()
  const supabase = createBrowserClient()

  const [checking, setChecking] = useState(true)
  const [userName, setUserName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [companySize, setCompanySize] = useState('')
  const [industry, setIndustry] = useState('')
  const [useCase, setUseCase] = useState('')
  const [referralSource, setReferralSource] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Prefill from existing profile; bounce out if already onboarded or signed out.
  useEffect(() => {
    let active = true
    ;(async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser) {
        router.replace('/login?redirect=/onboarding')
        return
      }

      try {
        const res = await fetch('/api/auth/me')
        if (res.ok) {
          const { user, organization } = await res.json()
          if (!active) return

          if (organization?.onboarding_completed_at) {
            router.replace('/dashboard')
            return
          }

          setUserName(user?.name || '')
          // Don't prefill the auto-generated "X's Organization" placeholder.
          if (organization?.name && !/'s Organization$/.test(organization.name)) {
            setCompanyName(organization.name)
          }
          setCompanySize(organization?.company_size || '')
          setIndustry(organization?.industry || '')
          setUseCase(organization?.use_case || '')
          setReferralSource(organization?.referral_source || '')
        }
      } finally {
        if (active) setChecking(false)
      }
    })()
    return () => {
      active = false
    }
  }, [router, supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: companyName,
          user_name: userName,
          company_size: companySize,
          industry,
          use_case: useCase,
          referral_source: referralSource,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save')
      }

      router.replace('/dashboard')
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
      setSaving(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          <span className="text-gray-400 text-sm">Loading…</span>
        </div>
      </div>
    )
  }

  const selectClass =
    'w-full px-4 py-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md text-white focus:border-blue-500 focus:outline-none appearance-none'
  const inputClass =
    'w-full px-4 py-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md text-white focus:border-blue-500 focus:outline-none'
  const labelClass = 'block text-sm font-medium text-gray-300 mb-2'

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Welcome to Synra</h1>
          <p className="text-sm text-gray-400">
            A few quick questions to set up your workspace
          </p>
        </div>

        <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-8">
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded text-sm text-red-400">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={labelClass}>Your name</label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                required
                className={inputClass}
                placeholder="Your name"
              />
            </div>

            <div>
              <label className={labelClass}>Company / project name</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
                className={inputClass}
                placeholder="Your company or project name"
              />
            </div>

            <div>
              <label className={labelClass}>Company size</label>
              <select
                value={companySize}
                onChange={(e) => setCompanySize(e.target.value)}
                required
                className={selectClass}
              >
                <option value="" disabled>
                  Select team size
                </option>
                {COMPANY_SIZES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>Industry</label>
              <select
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                required
                className={selectClass}
              >
                <option value="" disabled>
                  Select your industry
                </option>
                {INDUSTRIES.map((i) => (
                  <option key={i.value} value={i.value}>
                    {i.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>How did you hear about us?</label>
              <select
                value={referralSource}
                onChange={(e) => setReferralSource(e.target.value)}
                required
                className={selectClass}
              >
                <option value="" disabled>
                  Select an option
                </option>
                {REFERRAL_SOURCES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>What do you want to connect to AI?</label>
              <input
                type="text"
                value={useCase}
                onChange={(e) => setUseCase(e.target.value)}
                className={inputClass}
                placeholder="e.g. Supabase, PostgreSQL, MySQL, Stripe, Shopify"
              />
              <p className="text-[11px] text-gray-600 mt-1">
                Separate with commas. Helps us prioritize connectors.
              </p>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-gray-600 disabled:to-gray-700 text-white font-medium rounded-md transition-all"
            >
              {saving ? 'Saving…' : 'Continue to dashboard'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
