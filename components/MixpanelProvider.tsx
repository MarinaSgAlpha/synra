'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useDashboard } from '@/contexts/DashboardContext'
import { initMixpanel, identifyUser, trackEvent } from '@/lib/mixpanel'

const PAGE_NAMES: Record<string, string> = {
  '/dashboard': 'overview',
  '/dashboard/credentials': 'connections',
  '/dashboard/usage': 'usage',
  '/dashboard/billing': 'billing',
  '/dashboard/settings': 'settings',
  '/dashboard/support': 'support',
}

export function MixpanelProvider({ children }: { children: React.ReactNode }) {
  const { user, organization } = useDashboard()
  const pathname = usePathname()
  const identifiedFor = useRef<string | null>(null)
  const lastTrackedPath = useRef<string | null>(null)

  useEffect(() => {
    initMixpanel()
  }, [])

  useEffect(() => {
    if (!user?.id || identifiedFor.current === user.id) return
    identifyUser(user.id, {
      $email: user.email,
      $name: user.name,
      organization_id: organization?.id,
      organization_name: organization?.name,
      plan: organization?.plan,
      created_at: user.created_at,
    })
    identifiedFor.current = user.id
  }, [user, organization])

  useEffect(() => {
    if (!pathname || lastTrackedPath.current === pathname) return
    const pageName = PAGE_NAMES[pathname] ?? (pathname.replace(/^\/dashboard\/?/, '') || 'overview')
    trackEvent('page_viewed', { page: pageName, pathname })
    lastTrackedPath.current = pathname
  }, [pathname])

  return <>{children}</>
}
