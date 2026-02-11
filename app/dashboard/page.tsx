'use client'

import { useEffect, useState } from 'react'
import { useDashboard } from '@/contexts/DashboardContext'
import Link from 'next/link'

export default function DashboardPage() {
  const { user, organization } = useDashboard()
  const [connectionCount, setConnectionCount] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/credentials')
      .then((res) => res.json())
      .then((data) => setConnectionCount(data.credentials?.length ?? 0))
      .catch(() => setConnectionCount(0))
  }, [])

  return (
    <div className="max-w-5xl">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Overview</h1>
        <p className="text-sm text-gray-400 mt-1">
          Welcome back, {user?.name || 'User'}
        </p>
      </div>

      {/* Quick stats */}
      <div className="grid gap-4 md:grid-cols-3 mb-8">
        <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Plan</p>
          <p className="text-lg font-semibold text-white capitalize">{organization?.plan || 'Free'}</p>
        </div>
        <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Connections</p>
          <p className="text-lg font-semibold text-white">{connectionCount ?? '—'}</p>
        </div>
      </div>

      {/* Getting started */}
      <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold text-white mb-4">Get Started</h2>
        <div className="space-y-4">
          <div className="flex items-start gap-4 p-4 bg-[#0a0a0a] border border-[#1c1c1c] rounded-lg">
            <div className="w-8 h-8 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 text-sm font-bold flex-shrink-0">
              1
            </div>
            <div className="flex-1">
              <h3 className="text-white font-medium mb-1">Add your first connection</h3>
              <p className="text-sm text-gray-500 mb-3">
                Connect a Supabase database to start building AI-powered queries.
              </p>
              <Link
                href="/dashboard/credentials"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-md transition-all"
              >
                Add Connection
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>

          <div className="flex items-start gap-4 p-4 bg-[#0a0a0a] border border-[#1c1c1c] rounded-lg">
            <div className="w-8 h-8 rounded-full bg-[#1c1c1c] border border-[#2a2a2a] flex items-center justify-center text-gray-400 text-sm font-bold flex-shrink-0">
              2
            </div>
            <div>
              <h3 className="text-white font-medium mb-1">Get your gateway URL</h3>
              <p className="text-sm text-gray-400">
                An MCP endpoint will be generated automatically when you add credentials.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4 p-4 bg-[#0a0a0a] border border-[#1c1c1c] rounded-lg">
            <div className="w-8 h-8 rounded-full bg-[#1c1c1c] border border-[#2a2a2a] flex items-center justify-center text-gray-400 text-sm font-bold flex-shrink-0">
              3
            </div>
            <div>
              <h3 className="text-white font-medium mb-1">Connect to Claude</h3>
              <p className="text-sm text-gray-400">
                Paste your gateway URL into Claude and start querying real data.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Account info */}
      <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Account</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Name</p>
            <p className="text-white">{user?.name}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Email</p>
            <p className="text-white">{user?.email}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Organization</p>
            <p className="text-white">{organization?.name || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Plan</p>
            <p className="text-white capitalize">{organization?.plan || 'Free'}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
