/** Plans that grant full product access (not subject to free-tier test query limits). */
const PAID_PLANS = new Set([
  'starter',
  'pro',
  'team',
  'lifetime',
  'lifetime_appsumo',
  'annual',
  'annual_appsumo',
])

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
  return status === 'active'
}
