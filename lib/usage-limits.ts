import { createAdminClient } from '@/lib/supabase/admin'
import { isGrandfatheredFreeOrg } from '@/lib/subscription-access'

// Plan limits
export const PLAN_LIMITS = {
  free: {
    max_credentials: 2,
    daily_requests: 100,
    features: ['read_only'],
  },
  // Entry SKU for new signups now that the free tier is closed to new
  // accounts. One connection, capped volume — the upgrade axis to
  // Starter is connections (3) and daily request headroom.
  solo: {
    max_credentials: 1,
    daily_requests: 1000,
    features: ['read_only'],
  },
  starter: {
    max_credentials: 3,
    daily_requests: 10000,
    features: ['read_only'],
  },
  lifetime: {
    max_credentials: 2,
    daily_requests: 10000,
    features: ['read_only'],
  },
  // Public Annual SKU billed via Stripe at $149/year. Same access
  // tier as Starter — the price difference vs Starter is purely the
  // yearly-vs-monthly cadence, not a feature uplift.
  annual: {
    max_credentials: 3,
    daily_requests: 10000,
    features: ['read_only'],
  },
  // AppSumo lifetime mirrors the Stripe lifetime tier today. Kept as a
  // distinct plan so refund handling (deactivate webhook) and revenue
  // attribution stay clean — see lib/appsumo/redeem.ts.
  lifetime_appsumo: {
    max_credentials: 2,
    daily_requests: 10000,
    features: ['read_only'],
  },
  // AppSumo annual is the current AppSumo tier (replacing the lifetime
  // deal). Same feature set / limits as the AppSumo lifetime grandfathered
  // plan; the only difference is the 1-year expiry handled by the daily
  // cron at /api/cron/appsumo-expiry.
  annual_appsumo: {
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
  /** True when the org has no plan granting access (post-cutoff free org)
   * and needs to subscribe — distinct from hitting a plan limit. */
  subscription_required?: boolean
}

// Check if organization can create a new credential
export async function canCreateCredential(organizationId: string): Promise<UsageCheck> {
  const admin = createAdminClient()

  // Get organization plan
  const { data: org } = await admin
    .from('organizations')
    .select('plan, created_at')
    .eq('id', organizationId)
    .single()

  if (!org) {
    return { allowed: false, reason: 'Organization not found' }
  }

  const plan = org.plan as PlanType

  // Free tier is closed to new signups. Canceled subscriptions also land
  // here: the Stripe webhook downgrades the org to 'free', and post-cutoff
  // orgs on 'free' have no product access.
  if (plan === 'free' && !isGrandfatheredFreeOrg(plan, org.created_at)) {
    return {
      allowed: false,
      reason: 'A subscription is required to add database connections',
      subscription_required: true,
    }
  }

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
    .select('plan, created_at')
    .eq('id', organizationId)
    .single()

  if (!org) {
    return { allowed: false, reason: 'Organization not found' }
  }

  const plan = org.plan as PlanType

  // Post-cutoff free orgs (new signups and canceled subscriptions) have no
  // MCP access — this also covers old endpoint URLs that predate a cancel.
  if (plan === 'free' && !isGrandfatheredFreeOrg(plan, org.created_at)) {
    return {
      allowed: false,
      reason: 'A subscription is required to use MCP endpoints',
      subscription_required: true,
    }
  }

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
