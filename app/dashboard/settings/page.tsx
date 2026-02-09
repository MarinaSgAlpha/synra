'use client'

import { useDashboard } from '@/contexts/DashboardContext'

export default function SettingsPage() {
  const { user, organization } = useDashboard()

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-gray-400 mt-1">
          Manage your account and organization
        </p>
      </div>

      {/* Profile */}
      <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold text-white mb-4">Profile</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Name</label>
            <input
              type="text"
              defaultValue={user?.name || ''}
              disabled
              className="w-full px-4 py-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md text-white text-sm disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Email</label>
            <input
              type="email"
              defaultValue={user?.email || ''}
              disabled
              className="w-full px-4 py-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md text-white text-sm disabled:opacity-50"
            />
          </div>
        </div>
      </div>

      {/* Organization */}
      <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold text-white mb-4">Organization</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Organization Name</label>
            <input
              type="text"
              defaultValue={organization?.name || ''}
              disabled
              className="w-full px-4 py-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md text-white text-sm disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Slug</label>
            <input
              type="text"
              defaultValue={organization?.slug || ''}
              disabled
              className="w-full px-4 py-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md text-white text-sm disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Plan</label>
            <span className="inline-block px-3 py-1 text-xs font-medium text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-full capitalize">
              {organization?.plan || 'Free'}
            </span>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="bg-[#111] border border-red-500/20 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-red-400 mb-2">Danger Zone</h2>
        <p className="text-sm text-gray-400 mb-4">
          These actions are irreversible. Please be certain.
        </p>
        <button
          disabled
          className="px-4 py-2 text-sm text-red-400 border border-red-500/20 hover:bg-red-500/5 rounded-md transition-all disabled:opacity-50"
        >
          Delete Account
        </button>
      </div>
    </div>
  )
}
