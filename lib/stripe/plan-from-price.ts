/**
 * Map a Stripe price ID back to one of our plan slugs.
 *
 * Needed when a customer changes plan inside the Stripe customer portal:
 * no checkout happens, so there is no session metadata saying which plan
 * they chose. The subscription's current price is the only source of truth.
 *
 * Only recurring plans are mapped. Lifetime is a one-time payment and free
 * has no price, so neither can appear on a subscription.
 */

const RECURRING_PLANS = ['solo', 'starter', 'annual', 'pro', 'team'] as const

export type RecurringPlan = (typeof RECURRING_PLANS)[number]

type PlanPrices = Record<string, { priceId?: string | null }>

export function planFromPriceId(
  priceId: string | null | undefined,
  plans: PlanPrices
): RecurringPlan | null {
  if (!priceId) return null
  for (const slug of RECURRING_PLANS) {
    const configured = plans[slug]?.priceId
    if (configured && configured === priceId) return slug
  }
  return null
}
