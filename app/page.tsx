'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function HomePage() {
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createBrowserClient()

  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      router.push('/dashboard')
    } else {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center p-6">
      <div className="text-center max-w-2xl">
        <h1 className="text-5xl font-bold text-white mb-4">Synra</h1>
        <p className="text-xl text-gray-300 mb-2">Managed MCP Gateway</p>
        <p className="text-sm text-gray-500 mb-8">Coming Soon - Q2 2026</p>
        
        <div className="space-y-4">
          <p className="text-gray-400 mb-8">
            One URL. Works everywhere. We handle security, permissions, and monitoring.
          </p>

          <div className="flex gap-4 justify-center">
            <Link
              href="/login"
              className="px-6 py-3 bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-medium rounded-md transition-all"
            >
              Get Started
            </Link>
            <a
              href="https://mcpserver.design"
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3 bg-[#111] border border-[#1c1c1c] hover:border-blue-500/30 text-gray-300 hover:text-white rounded-md transition-all"
            >
              Learn More
            </a>
          </div>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-3 text-left">
          <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-6">
            <div className="text-2xl mb-3">🔐</div>
            <h3 className="text-white font-medium mb-2">Secure by Default</h3>
            <p className="text-sm text-gray-500">
              Read-only database access. Granular permissions. Complete audit logs.
            </p>
          </div>
          
          <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-6">
            <div className="text-2xl mb-3">🌍</div>
            <h3 className="text-white font-medium mb-2">Works Everywhere</h3>
            <p className="text-sm text-gray-500">
              One gateway URL for all devices. No config files to sync.
            </p>
          </div>
          
          <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-6">
            <div className="text-2xl mb-3">🔌</div>
            <h3 className="text-white font-medium mb-2">Pre-Built Connectors</h3>
            <p className="text-sm text-gray-500">
              PostgreSQL, HubSpot, GitHub. More connectors coming soon.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
