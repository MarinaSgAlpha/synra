'use client'

import { useDashboard } from '@/contexts/DashboardContext'
import { useState, useEffect } from 'react'

const COMPANY_SIZES = [
  { value: 'solo', label: 'Solo / Freelancer' },
  { value: '2-10', label: '2–10 employees' },
  { value: '11-50', label: '11–50 employees' },
  { value: '51-200', label: '51–200 employees' },
  { value: '201-1000', label: '201–1,000 employees' },
  { value: '1000+', label: '1,000+ employees' },
]

export default function SettingsPage() {
  const { organization, user, refresh } = useDashboard()
  const [orgName, setOrgName] = useState('')
  const [companySize, setCompanySize] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (organization) {
      setOrgName(organization.name || '')
      setCompanySize(organization.company_size || '')
    }
  }, [organization])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)

    try {
      const res = await fetch('/api/organization', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: orgName,
          company_size: companySize || null,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update')
      }

      setSaved(true)
      await refresh() // Update sidebar + overview with new data
      setTimeout(() => setSaved(false), 3000)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const hasChanges =
    orgName !== (organization?.name || '') ||
    companySize !== (organization?.company_size || '')

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-gray-400 mt-1">
          Manage your organization
        </p>
      </div>

      {/* Organization Settings */}
      <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Organization Name
          </label>
          <input
            type="text"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            className="w-full px-4 py-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md text-white text-sm focus:border-blue-500 focus:outline-none"
            placeholder="Your organization name"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Organization Slug
          </label>
          <input
            type="text"
            value={organization?.slug || ''}
            disabled
            className="w-full px-4 py-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md text-gray-400 text-sm font-mono cursor-not-allowed"
          />
          <p className="text-[11px] text-gray-500 mt-1">
            Slug cannot be changed
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Company Size
          </label>
          <select
            value={companySize}
            onChange={(e) => setCompanySize(e.target.value)}
            className="w-full px-4 py-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md text-white text-sm focus:border-blue-500 focus:outline-none appearance-none"
          >
            <option value="">Not specified</option>
            {COMPANY_SIZES.map((size) => (
              <option key={size.value} value={size.value}>
                {size.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Account Email
          </label>
          <input
            type="email"
            value={user?.email || ''}
            disabled
            className="w-full px-4 py-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md text-gray-400 text-sm cursor-not-allowed"
          />
          <p className="text-[11px] text-gray-500 mt-1">
            Email is tied to your login and cannot be changed here
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Current Plan
          </label>
          <div className="flex items-center gap-3">
            <span className="px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-md text-sm text-blue-400 font-medium">
              {(organization?.plan || 'free').charAt(0).toUpperCase() + (organization?.plan || 'free').slice(1)}
            </span>
            <span className="text-xs text-gray-400">
              Billing and invoices coming soon
            </span>
          </div>
        </div>

        {/* Save button */}
        <div className="pt-2 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="px-5 py-2.5 bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-gray-700 disabled:to-gray-800 disabled:text-gray-500 text-white text-sm font-medium rounded-md transition-all"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>

          {saved && (
            <span className="text-sm text-green-400">Saved!</span>
          )}

          {error && (
            <span className="text-sm text-red-400">{error}</span>
          )}
        </div>
      </div>
    </div>
  )
}
