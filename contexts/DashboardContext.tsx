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
}

const DashboardContext = createContext<DashboardContextType>({
  user: null,
  organization: null,
  loading: true,
  logout: async () => {},
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

        // Get organization via membership
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

          if (orgData) setOrganization(orgData)
        }
      }
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
    <DashboardContext.Provider value={{ user, organization, loading, logout }}>
      {children}
    </DashboardContext.Provider>
  )
}
