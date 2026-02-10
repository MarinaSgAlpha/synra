'use client'

import { useDashboard } from '@/contexts/DashboardContext'
import { useState } from 'react'

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    features: [
      '1 credential',
      '100 requests/day',
      'Read-only access',
      'Basic support',
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    price: 29,
    features: [
      '5 credentials',
      '10,000 requests/day',
      'Read-only access',
      'Email support',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 99,
    popular: true,
    features: [
      'Unlimited credentials',
      '100,000 requests/day',
      'Read + Write access',
      'Priority support',
      'Advanced analytics',
    ],
  },
  {
    id: 'team',
    name: 'Team',
    price: 299,
    features: [
      'Everything in Pro',
      'Unlimited requests',
      'SSO & SAML',
      'Dedicated support',
      'SLA guarantee',
      'Custom integrations',
    ],
  },
]

export default function SettingsPage() {
  const { organization } = useDashboard()
  const [loading, setLoading] = useState<string | null>(null)

  const currentPlan = organization?.plan || 'free'

  const handleUpgrade = async (planId: string) => {
    if (planId === 'free') return

    setLoading(planId)
    try {
      const res = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId }),
      })

      if (res.ok) {
        const { url } = await res.json()
        window.location.href = url
      } else {
        const { error } = await res.json()
        alert(`Error: ${error}`)
      }
    } catch (err) {
      console.error('Upgrade error:', err)
      alert('Failed to start checkout')
    } finally {
      setLoading(null)
    }
  }

  const handleManageBilling = async () => {
    setLoading('portal')
    try {
      const res = await fetch('/api/stripe/create-portal-session', {
        method: 'POST',
      })

      if (res.ok) {
        const { url } = await res.json()
        window.location.href = url
      } else {
        const { error } = await res.json()
        alert(`Error: ${error}`)
      }
    } catch (err) {
      console.error('Portal error:', err)
      alert('Failed to open billing portal')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="max-w-7xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-gray-400 mt-1">
          Manage your subscription and billing
        </p>
      </div>

      {/* Current Plan */}
      {currentPlan !== 'free' && (
        <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-6 mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">
                Current Plan: <span className="text-blue-400">{currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)}</span>
              </h2>
              <p className="text-sm text-gray-400 mt-1">
                Manage your subscription, payment method, and billing history
              </p>
            </div>
            <button
              onClick={handleManageBilling}
              disabled={loading === 'portal'}
              className="px-4 py-2 bg-white text-black rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 font-medium"
            >
              {loading === 'portal' ? 'Loading...' : 'Manage Billing'}
            </button>
          </div>
        </div>
      )}

      {/* Pricing Plans */}
      <div className="grid md:grid-cols-4 gap-6">
        {PLANS.map((plan) => {
          const isCurrent = plan.id === currentPlan
          const isDowngrade = PLANS.findIndex(p => p.id === currentPlan) > PLANS.findIndex(p => p.id === plan.id)

          return (
            <div
              key={plan.id}
              className={`bg-[#111] border rounded-lg p-6 flex flex-col ${
                plan.popular
                  ? 'border-blue-500 relative'
                  : 'border-[#1c1c1c]'
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-blue-500 text-white text-xs rounded-full font-medium">
                  Popular
                </div>
              )}

              <div className="mb-4">
                <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                <div className="mt-2">
                  {plan.price === 0 ? (
                    <span className="text-3xl font-bold text-white">Free</span>
                  ) : (
                    <>
                      <span className="text-3xl font-bold text-white">${plan.price}</span>
                      <span className="text-gray-400 text-sm">/month</span>
                    </>
                  )}
                </div>
              </div>

              <ul className="space-y-2 mb-6 flex-1">
                {plan.features.map((feature, i) => (
                  <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                    <span className="text-green-400 mt-0.5">✓</span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handleUpgrade(plan.id)}
                disabled={isCurrent || isDowngrade || loading === plan.id || plan.id === 'free'}
                className={`w-full py-2 rounded-lg font-medium transition-colors ${
                  isCurrent
                    ? 'bg-[#1c1c1c] text-gray-500 cursor-default'
                    : isDowngrade || plan.id === 'free'
                    ? 'bg-[#1c1c1c] text-gray-500 cursor-not-allowed'
                    : 'bg-white text-black hover:bg-gray-200'
                } disabled:opacity-50`}
              >
                {loading === plan.id
                  ? 'Loading...'
                  : isCurrent
                  ? 'Current Plan'
                  : isDowngrade
                  ? 'Contact Sales'
                  : plan.id === 'free'
                  ? 'Free Forever'
                  : 'Upgrade'}
              </button>
            </div>
          )
        })}
      </div>

      {/* Organization Settings Section */}
      <div className="mt-12 bg-[#111] border border-[#1c1c1c] rounded-lg p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Organization Settings</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Organization Name</label>
            <input
              type="text"
              value={organization?.name || ''}
              disabled
              className="w-full px-4 py-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-lg text-white font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Slug</label>
            <input
              type="text"
              value={organization?.slug || ''}
              disabled
              className="w-full px-4 py-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-lg text-white font-mono text-sm"
            />
          </div>
          <p className="text-xs text-gray-500">
            Contact support to update organization settings
          </p>
        </div>
      </div>
    </div>
  )
}
