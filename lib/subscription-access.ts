/** Plans that grant full product access (not subject to free-tier test query limits). */
const PAID_PLANS = new Set([
  'solo',
  'starter',
  'pro',
  'team',
  'lifetime',
  'lifetime_appsumo',
  'annual',
  'annual_appsumo',
])

/** Subscription statuses that grant access. Trialing counts: Solo checkout
 * starts a 7-day Stripe trial and the webhook stores status 'trialing'
 * until the first invoice is paid. */
const ACTIVE_STATUSES = new Set(['active', 'trialing'])

/**
 * Free tier closed to new signups on this date. Orgs created before the
 * cutoff keep their free-plan access forever (grandfathered); orgs created
 * after must subscribe (Solo and up) before adding connections or making
 * MCP requests.
 */
export const FREE_TIER_CUTOFF = new Date('2026-07-16T00:00:00Z')

/**
 * Whether an org has paid access. Lifetime and AppSumo plans are one-time
 * activations — they have no stripe_subscription_id, so we key off plan +
 * active status instead.
 */
export function hasPaidAccess(
  plan: string | null | undefined,
  status: string | null | undefined
): boolean {
  if (!plan || !PAID_PLANS.has(plan)) return false
  return !!status && ACTIVE_STATUSES.has(status)
}

/**
 * Whether a free-plan org keeps free access (created before the cutoff).
 * Paid plans should be checked with hasPaidAccess, not this.
 */
export function isGrandfatheredFreeOrg(
  plan: string | null | undefined,
  orgCreatedAt: string | Date | null | undefined
): boolean {
  if (plan !== 'free' || !orgCreatedAt) return false
  return new Date(orgCreatedAt) < FREE_TIER_CUTOFF
}

/**
 * Whether an org can use the product (connections + MCP requests).
 * Paid/trialing plans always can; free orgs only if grandfathered.
 */
export function hasProductAccess(
  plan: string | null | undefined,
  status: string | null | undefined,
  orgCreatedAt: string | Date | null | undefined
): boolean {
  if (hasPaidAccess(plan, status)) return true
  return isGrandfatheredFreeOrg(plan, orgCreatedAt)
}
