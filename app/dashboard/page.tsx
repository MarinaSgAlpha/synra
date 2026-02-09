'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { User, Organization } from '@/types'

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null)
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createBrowserClient()

  useEffect(() => {
    loadUserData()
  }, [])

  const loadUserData = async () => {
    try {
      // Get auth user
      const { data: { user: authUser } } = await supabase.auth.getUser()
      
      if (!authUser) {
        router.push('/login')
        return
      }

      // Get user record — users.id = auth user id
      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single()

      if (userData) {
        setUser(userData)

        // Get organization
        const { data: membership } = await supabase
          .from('organization_members')
          .select('organization_id')
          .eq('user_id', userData.id)
          .single()

        if (membership) {
          const { data: orgData } = await supabase
            .from('organizations')
            .select('*')
            .eq('id', membership.organization_id)
            .single()

          if (orgData) {
            setOrganization(orgData)
          }
        }
      }
    } catch (error) {
      console.error('Error loading user data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Dashboard</h1>
            <p className="text-sm text-gray-400">
              Welcome back, {user?.name || 'User'}
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 bg-[#111] border border-[#1c1c1c] hover:border-red-500/30 text-gray-300 hover:text-red-400 rounded-md transition-all text-sm"
          >
            Sign Out
          </button>
        </div>

        {/* Account Info Card */}
        <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold text-white mb-4">Account Information</h2>
          <div className="space-y-3">
            <div>
              <span className="text-sm text-gray-400">Name:</span>
              <p className="text-white">{user?.name}</p>
            </div>
            <div>
              <span className="text-sm text-gray-400">Email:</span>
              <p className="text-white">{user?.email}</p>
            </div>
            <div>
              <span className="text-sm text-gray-400">Organization:</span>
              <p className="text-white">{organization?.name || 'No organization'}</p>
            </div>
          </div>
        </div>

        {/* Coming Soon Section */}
        <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-8 text-center">
          <h2 className="text-2xl font-semibold text-white mb-4">
            MCP Gateway Coming Soon
          </h2>
          <p className="text-gray-400 mb-6">
            We're building the managed MCP gateway. Next steps:
          </p>
          <div className="grid gap-4 md:grid-cols-3 text-left max-w-3xl mx-auto">
            <div className="bg-[#0a0a0a] border border-[#1c1c1c] rounded-lg p-4">
              <div className="text-blue-500 mb-2">🔑</div>
              <h3 className="text-white font-medium mb-1">Add Credentials</h3>
              <p className="text-sm text-gray-500">
                Connect your Supabase database
              </p>
            </div>
            <div className="bg-[#0a0a0a] border border-[#1c1c1c] rounded-lg p-4">
              <div className="text-blue-500 mb-2">🔗</div>
              <h3 className="text-white font-medium mb-1">Get Gateway URL</h3>
              <p className="text-sm text-gray-500">
                Your personal MCP endpoint
              </p>
            </div>
            <div className="bg-[#0a0a0a] border border-[#1c1c1c] rounded-lg p-4">
              <div className="text-blue-500 mb-2">🚀</div>
              <h3 className="text-white font-medium mb-1">Use in Claude</h3>
              <p className="text-sm text-gray-500">
                Connect AI to real data
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
