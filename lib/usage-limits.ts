import { createAdminClient } from '@/lib/supabase/admin'

// Plan limits
export const PLAN_LIMITS = {
  free: {
    max_credentials: 2,
    daily_requests: 100,
    features: ['read_only'],
  },
  starter: {
    max_credentials: 2,
    daily_requests: 10000,
    features: ['read_only'],
  },
  lifetime: {
    max_credentials: 2,
    daily_requests: 10000,
    features: ['read_only'],
  },
  pro: {
    max_credentials: -1, // unlimited
    daily_requests: 100000,
    features: ['read_only', 'write_access', 'analytics'],
  },
  team: {
    max_credentials: -1, // unlimited
    daily_requests: -1, // unlimited
    features: ['read_only', 'write_access', 'analytics', 'sso', 'dedicated_support'],
  },
} as const

export type PlanType = keyof typeof PLAN_LIMITS

interface UsageCheck {
  allowed: boolean
  reason?: string
  current?: number
  limit?: number
}

// Check if organization can create a new credential
export async function canCreateCredential(organizationId: string): Promise<UsageCheck> {
  const admin = createAdminClient()

  // Get organization plan
  const { data: org } = await admin
    .from('organizations')
    .select('plan')
    .eq('id', organizationId)
    .single()

  if (!org) {
    return { allowed: false, reason: 'Organization not found' }
  }

  const plan = org.plan as PlanType
  const limits = PLAN_LIMITS[plan]

  // Unlimited credentials
  if (limits.max_credentials === -1) {
    return { allowed: true }
  }

  // Count current credentials
  const { count } = await admin
    .from('credentials')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('is_active', true)

  const currentCount = count || 0

  if (currentCount >= limits.max_credentials) {
    return {
      allowed: false,
      reason: `Plan limit reached: ${currentCount}/${limits.max_credentials} credentials`,
      current: currentCount,
      limit: limits.max_credentials,
    }
  }

  return { allowed: true, current: currentCount, limit: limits.max_credentials }
}

// Check if organization has exceeded daily request limit
export async function canMakeRequest(organizationId: string): Promise<UsageCheck> {
  const admin = createAdminClient()

  // Get organization plan
  const { data: org } = await admin
    .from('organizations')
    .select('plan')
    .eq('id', organizationId)
    .single()

  if (!org) {
    return { allowed: false, reason: 'Organization not found' }
  }

  const plan = org.plan as PlanType
  const limits = PLAN_LIMITS[plan]

  // Unlimited requests
  if (limits.daily_requests === -1) {
    return { allowed: true }
  }

  // Count requests today
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const { count } = await admin
    .from('usage_logs')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .gte('created_at', today.toISOString())

  const currentCount = count || 0

  if (currentCount >= limits.daily_requests) {
    return {
      allowed: false,
      reason: `Daily limit exceeded: ${currentCount}/${limits.daily_requests} requests`,
      current: currentCount,
      limit: limits.daily_requests,
    }
  }

  return { allowed: true, current: currentCount, limit: limits.daily_requests }
}

// Check if organization has a specific feature
export function hasFeature(plan: PlanType, feature: string): boolean {
  const limits = PLAN_LIMITS[plan]
  return (limits.features as readonly string[]).includes(feature)
}
