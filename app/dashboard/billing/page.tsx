'use client'

import { useDashboard } from '@/contexts/DashboardContext'
import { useEffect, useState } from 'react'
import { trackEvent } from '@/lib/mixpanel'

/**
 * Subscription detail we need for the AppSumo annual UX that isn't on
 * the dashboard context yet. Fetched once on mount via /api/auth/me,
 * which also returns the subscription row.
 */
interface SubscriptionDetail {
  plan: string
  status: string
  current_period_end: string | null
  stripe_customer_id: string | null
  cancel_at_period_end?: boolean | null
}

const RENEWAL_BANNER_WINDOW_DAYS = 30

interface ReferralInfo {
  code: string
  link: string
  signed_up: number
  rewarded: number
  total_credit_cents: number
  rewards_this_year: number
  yearly_cap: number
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const target = new Date(iso).getTime()
  if (Number.isNaN(target)) return null
  const ms = target - Date.now()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
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

export default function BillingPage() {
  const { organization } = useDashboard()
  const [billingLoading, setBillingLoading] = useState<string | null>(null)
  const [billingError, setBillingError] = useState<string | null>(null)
  const [subscription, setSubscription] = useState<SubscriptionDetail | null>(null)
  const [referral, setReferral] = useState<ReferralInfo | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)

  // Load the subscription row separately so we have current_period_end
  // for the renewal banner / "Renews on" label.
  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.subscription) return
        setSubscription(data.subscription as SubscriptionDetail)
      })
      .catch(() => {
        /* non-fatal; banner / dates just won't render */
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Referral link + stats (also lazily generates the org's code)
  useEffect(() => {
    let cancelled = false
    fetch('/api/referrals')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.code) return
        setReferral(data as ReferralInfo)
      })
      .catch(() => {
        /* non-fatal; the referral card just won't render */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleCopyReferralLink = async () => {
    if (!referral) return
    try {
      await navigator.clipboard.writeText(referral.link)
      setLinkCopied(true)
      trackEvent('referral_link_copied', { current_plan: currentPlan })
      setTimeout(() => setLinkCopied(false), 2000)
    } catch {
      /* clipboard unavailable */
    }
  }

  const currentPlan = (organization?.plan || 'free').toLowerCase()
  const isFree = currentPlan === 'free'
  const isStripeLifetime = currentPlan === 'lifetime'
  const isAppsumoLifetime = currentPlan === 'lifetime_appsumo'
  const isAppsumoAnnual = currentPlan === 'annual_appsumo'
  const isStripeAnnual = currentPlan === 'annual'
  const isStripeStarter = currentPlan === 'starter'
  const isStripeSolo = currentPlan === 'solo'
  // Plans that are paid but DON'T have a Stripe portal we can send the
  // user to (lifetime is one-time, AppSumo plans aren't Stripe at all).
  // Used to hide the "Manage Billing" button without hiding all plan
  // info.
  const isPaidNoStripePortal =
    isStripeLifetime || isAppsumoLifetime || isAppsumoAnnual
  // Anyone with a paid plan (whether portal-managed or not). Used to
  // suppress the upgrade cards shown to free users.
  const hasPaidPlan =
    isStripeSolo ||
    isStripeStarter ||
    isStripeAnnual ||
    isStripeLifetime ||
    isAppsumoAnnual ||
    isAppsumoLifetime

  const periodEndIso = subscription?.current_period_end ?? null
  const daysLeft = daysUntil(periodEndIso)
  const showRenewalBanner =
    isAppsumoAnnual &&
    daysLeft !== null &&
    daysLeft <= RENEWAL_BANNER_WINDOW_DAYS &&
    daysLeft >= 0

  const handleUpgrade = async (plan: 'solo' | 'starter' | 'annual' | 'lifetime') => {
    setBillingLoading(plan)
    setBillingError(null)
    trackEvent('upgrade_clicked', { plan, current_plan: currentPlan, source: 'billing' })
    try {
      const res = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        throw new Error(data.error || 'Failed to start checkout')
      }
    } catch (err: any) {
      setBillingError(err.message || 'Failed to start checkout')
      setBillingLoading(null)
    }
  }

  const handleManageBilling = async () => {
    setBillingLoading('portal')
    setBillingError(null)
    trackEvent('billing_portal_opened', { current_plan: currentPlan })
    try {
      const res = await fetch('/api/stripe/create-portal-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        throw new Error(data.error || 'Failed to open billing portal')
      }
    } catch (err: any) {
      setBillingError(err.message || 'Failed to open billing portal')
      setBillingLoading(null)
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Billing & Plan</h1>
        <p className="text-sm text-gray-400 mt-1">
          Manage your subscription, plan, and payment details
        </p>
      </div>

      {/* Renewal-window banner — appears for AppSumo annual customers
          within 30 days of expiry. Surfaces the Stripe Starter CTA as
          the in-app renewal path. */}
      {showRenewalBanner && (
        <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <p className="text-sm text-white font-medium">
              Your AppSumo annual plan expires in {daysLeft}{' '}
              {daysLeft === 1 ? 'day' : 'days'} ({formatDate(periodEndIso)}).
            </p>
            <p className="text-xs text-amber-200/80 mt-1">
              Avoid losing access — switch to monthly Starter now, or renew
              through AppSumo if a renewal is available on your deal.
            </p>
          </div>
          <button
            onClick={() => handleUpgrade('starter')}
            disabled={billingLoading !== null}
            className="px-4 py-2 text-sm bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold rounded-md transition-all whitespace-nowrap"
          >
            {billingLoading === 'starter'
              ? 'Redirecting…'
              : 'Renew via Stripe ($19/mo)'}
          </button>
        </div>
      )}

      {/* Current plan summary */}
      <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Current Plan</p>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-md text-sm text-blue-400 font-medium">
                {currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)}
              </span>
              {isStripeLifetime && (
                <span className="text-xs text-green-400">Pay once, use forever</span>
              )}
              {isAppsumoLifetime && (
                <span className="text-xs text-green-400">Pay once, use forever (AppSumo)</span>
              )}
              {isAppsumoAnnual && periodEndIso && (
                <span className="text-xs text-gray-300">
                  Renews <span className="text-white">{formatDate(periodEndIso)}</span>
                </span>
              )}
              {(isStripeAnnual || isStripeStarter || isStripeSolo) && periodEndIso && (
                <span className="text-xs text-gray-300">
                  {subscription?.status === 'trialing'
                    ? 'Trial ends'
                    : subscription?.cancel_at_period_end
                      ? 'Cancels'
                      : 'Renews'}{' '}
                  <span className="text-white">{formatDate(periodEndIso)}</span>
                </span>
              )}
            </div>
          </div>
          {!isFree && !isPaidNoStripePortal && (
            <button
              onClick={handleManageBilling}
              disabled={billingLoading !== null}
              className="px-5 py-2.5 text-sm bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-medium rounded-md transition-all disabled:opacity-50"
            >
              {billingLoading === 'portal' ? 'Opening...' : 'Manage Billing'}
            </button>
          )}
        </div>
      </div>

      {billingError && (
        <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 rounded-md">
          <p className="text-sm text-red-400">{billingError}</p>
        </div>
      )}

      {/* Plan options for free users (grandfathered orgs keep free access;
          post-cutoff orgs must pick a plan before adding connections) */}
      {isFree && (
        <div className="grid md:grid-cols-3 gap-4">
          {/* Solo — entry SKU with 7-day trial */}
          <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-6 flex flex-col relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-gradient-to-br from-green-500 to-green-600 text-white text-[10px] font-bold px-3 py-1 rounded-bl-lg">
              7-DAY FREE TRIAL
            </div>
            <h3 className="text-white font-semibold mb-1">Solo</h3>
            <div className="flex items-baseline gap-1 mb-4">
              <span className="text-3xl font-bold text-white">$9.99</span>
              <span className="text-sm text-gray-400">/month</span>
            </div>
            <ul className="text-sm text-gray-400 space-y-2 mb-6 flex-grow">
              <li className="flex items-start gap-2"><span className="text-green-400 flex-shrink-0">✓</span><span>1 database connection</span></li>
              <li className="flex items-start gap-2"><span className="text-green-400 flex-shrink-0">✓</span><span>1,000 requests/day</span></li>
              <li className="flex items-start gap-2"><span className="text-green-400 flex-shrink-0">✓</span><span>PostgreSQL, MySQL, MS SQL & Supabase</span></li>
              <li className="flex items-start gap-2"><span className="text-green-400 flex-shrink-0">✓</span><span>Read-only by default</span></li>
              <li className="flex items-start gap-2"><span className="text-green-400 flex-shrink-0">✓</span><span>Email support</span></li>
            </ul>
            <button
              onClick={() => handleUpgrade('solo')}
              disabled={billingLoading !== null}
              className="w-full px-4 py-2.5 text-sm border-2 border-blue-500 hover:border-blue-400 bg-transparent text-blue-400 hover:text-blue-300 font-medium rounded-md transition-all disabled:opacity-50"
            >
              {billingLoading === 'solo' ? 'Redirecting...' : 'Start Free Trial'}
            </button>
            <p className="text-center text-[11px] text-gray-500 mt-2">Card required, cancel anytime</p>
          </div>

          {/* Starter */}
          <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-6 flex flex-col">
            <h3 className="text-white font-semibold mb-1">Starter</h3>
            <div className="flex items-baseline gap-1 mb-4">
              <span className="text-3xl font-bold text-white">$19</span>
              <span className="text-sm text-gray-400">/month</span>
            </div>
            <ul className="text-sm text-gray-400 space-y-2 mb-6 flex-grow">
              <li className="flex items-start gap-2"><span className="text-green-400 flex-shrink-0">✓</span><span>3 database connections</span></li>
              <li className="flex items-start gap-2"><span className="text-green-400 flex-shrink-0">✓</span><span>10,000 requests/day</span></li>
              <li className="flex items-start gap-2"><span className="text-green-400 flex-shrink-0">✓</span><span>PostgreSQL, MySQL, MS SQL & Supabase</span></li>
              <li className="flex items-start gap-2"><span className="text-green-400 flex-shrink-0">✓</span><span>Read-only by default</span></li>
              <li className="flex items-start gap-2"><span className="text-green-400 flex-shrink-0">✓</span><span>Email support</span></li>
            </ul>
            <button
              onClick={() => handleUpgrade('starter')}
              disabled={billingLoading !== null}
              className="w-full px-4 py-2.5 text-sm border-2 border-blue-500 hover:border-blue-400 bg-transparent text-blue-400 hover:text-blue-300 font-medium rounded-md transition-all disabled:opacity-50"
            >
              {billingLoading === 'starter' ? 'Redirecting...' : 'Choose Starter'}
            </button>
          </div>

          {/* Annual — public Stripe $149/year SKU (matches marketing site). */}
          <div className="bg-[#111] border-2 border-blue-500/50 rounded-lg p-6 flex flex-col relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-gradient-to-br from-blue-500 to-blue-600 text-white text-[10px] font-bold px-3 py-1 rounded-bl-lg">
              SAVE 35%
            </div>
            <h3 className="text-white font-semibold mb-1">Annual Access</h3>
            <div className="flex items-baseline gap-1 mb-4">
              <span className="text-3xl font-bold text-white">$149</span>
              <span className="text-sm text-gray-400">/year</span>
            </div>
            <ul className="text-sm text-gray-400 space-y-2 mb-6 flex-grow">
              <li className="flex items-start gap-2"><span className="text-green-400 flex-shrink-0">✓</span><span>3 database connections</span></li>
              <li className="flex items-start gap-2"><span className="text-green-400 flex-shrink-0">✓</span><span>10,000 requests/day</span></li>
              <li className="flex items-start gap-2"><span className="text-green-400 flex-shrink-0">✓</span><span>PostgreSQL, MySQL, MS SQL & Supabase</span></li>
              <li className="flex items-start gap-2"><span className="text-green-400 flex-shrink-0">✓</span><span>Read-only by default</span></li>
              <li className="flex items-start gap-2"><span className="text-blue-400 flex-shrink-0">★</span><span className="text-blue-400 font-medium">All updates included</span></li>
            </ul>
            <button
              onClick={() => handleUpgrade('annual')}
              disabled={billingLoading !== null}
              className="w-full px-4 py-2.5 text-sm bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold rounded-md transition-all disabled:opacity-50"
            >
              {billingLoading === 'annual' ? 'Redirecting...' : 'Get Annual Access'}
            </button>
            <p className="text-center text-[11px] text-gray-500 mt-2">Renews annually, cancel anytime</p>
          </div>
        </div>
      )}

      {/* Lifetime grandfathered note */}
      {(isStripeLifetime || isAppsumoLifetime) && (
        <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-6">
          <p className="text-sm text-gray-300">
            You have <span className="text-blue-400 font-medium">Lifetime Access</span>
            {isAppsumoLifetime && (
              <> via your <span className="text-blue-400 font-medium">AppSumo</span> deal</>
            )}
            . There are no recurring charges. For receipts or questions, email{' '}
            <a href="mailto:hello@mcpserver.design" className="text-blue-400 hover:text-blue-300">hello@mcpserver.design</a>.
          </p>
        </div>
      )}

      {/* AppSumo annual note (non-banner state — outside the 30-day window) */}
      {isAppsumoAnnual && !showRenewalBanner && (
        <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-6">
          <p className="text-sm text-gray-300">
            You have <span className="text-blue-400 font-medium">AppSumo Annual Access</span>.
            {periodEndIso && (
              <>
                {' '}Your access {subscription?.status === 'expired' ? 'expired' : 'renews'} on{' '}
                <span className="text-white">{formatDate(periodEndIso)}</span>.
              </>
            )}
            {' '}You&apos;ll get an email 30 days before expiry with renewal options.
            For receipts or questions, email{' '}
            <a href="mailto:hello@mcpserver.design" className="text-blue-400 hover:text-blue-300">hello@mcpserver.design</a>.
          </p>
        </div>
      )}

      {/* Referral program — give a month, get a month */}
      {referral && (
        <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-6 mt-6">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-white font-semibold">Refer a friend, get a month free</h3>
            <span className="px-2 py-0.5 bg-green-500/10 border border-green-500/20 rounded text-[10px] text-green-400 font-mono uppercase tracking-wider">New</span>
          </div>
          <p className="text-sm text-gray-400 mb-4">
            Friends who sign up with your link get a 14-day trial instead of 7. When they
            become a paying customer, you get one month of your plan free — stackable, up
            to {referral.yearly_cap} months a year.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <code className="flex-1 px-3 py-2.5 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md text-xs text-gray-300 font-mono truncate">
              {referral.link}
            </code>
            <button
              onClick={handleCopyReferralLink}
              className="px-5 py-2.5 text-sm bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-medium rounded-md transition-all whitespace-nowrap"
            >
              {linkCopied ? 'Copied!' : 'Copy Link'}
            </button>
          </div>
          {(referral.signed_up > 0 || referral.rewarded > 0) && (
            <div className="flex flex-wrap gap-6 mt-4 pt-4 border-t border-[#1c1c1c]">
              <div>
                <p className="text-lg font-bold text-white">{referral.signed_up}</p>
                <p className="text-xs text-gray-500">friends signed up</p>
              </div>
              <div>
                <p className="text-lg font-bold text-white">{referral.rewarded}</p>
                <p className="text-xs text-gray-500">converted to paid</p>
              </div>
              <div>
                <p className="text-lg font-bold text-green-400">
                  ${(referral.total_credit_cents / 100).toFixed(2)}
                </p>
                <p className="text-xs text-gray-500">credit earned</p>
              </div>
            </div>
          )}
        </div>
      )}

      <p className="text-center text-xs text-gray-500 mt-8">
        Need more connections or custom pricing?{' '}
        <a href="mailto:hello@mcpserver.design" className="text-blue-400 hover:text-blue-300">Contact us</a>.
      </p>
    </div>
  )
}
