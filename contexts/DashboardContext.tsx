'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { User, Organization } from '@/types'

interface DashboardContextType {
  user: User | null
  organization: Organization | null
  loading: boolean
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const DashboardContext = createContext<DashboardContextType>({
  user: null,
  organization: null,
  loading: true,
  logout: async () => {},
  refresh: async () => {},
})

export function useDashboard() {
  return useContext(DashboardContext)
}

export function DashboardProvider({ children }: { children: ReactNode }) {
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
      // Check auth session first
      const { data: { user: authUser } } = await supabase.auth.getUser()

      if (!authUser) {
        router.push('/login')
        return
      }

      // Fetch user + org via API route (bypasses RLS)
      const res = await fetch('/api/auth/me')
      if (!res.ok) {
        if (res.status === 401) {
          router.push('/login')
          return
        }
        console.error('Failed to load user data')
        return
      }

      const data = await res.json()
      if (data.user) setUser(data.user)
      if (data.organization) setOrganization(data.organization)
    } catch (error) {
      console.error('Error loading user data:', error)
    } finally {
      setLoading(false)
    }
  }

  const logout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <DashboardContext.Provider value={{ user, organization, loading, logout, refresh: loadUserData }}>
      {children}
    </DashboardContext.Provider>
  )
}
