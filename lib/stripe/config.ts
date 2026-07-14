import Stripe from 'stripe'

// Lazy initialization to avoid errors during build
let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not set')
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2026-01-28.clover',
      typescript: true,
    })
  }
  return _stripe
}

// Export for convenience (will throw if not configured)
export const stripe = new Proxy({} as Stripe, {
  get(_, prop) {
    return (getStripe() as any)[prop]
  },
})

// Pricing plans (free plan hidden from UI but exists for legacy/grandfathered users)
export const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    priceId: null,
    features: [
      '2 database connections',
      '100 requests/day',
      'Read-only access',
      'Basic support',
    ],
  },
  // Entry SKU for new signups after the free tier was closed. 7-day
  // trial is applied at checkout (subscription_data.trial_period_days),
  // not on the Stripe price itself.
  solo: {
    name: 'Solo',
    price: 9.99,
    priceId: process.env.STRIPE_PRICE_ID_SOLO,
    features: [
      '1 database connection',
      '1,000 requests/day',
      'Read-only access',
      'Email support',
    ],
  },
  starter: {
    name: 'Starter',
    price: 19,
    priceId: process.env.STRIPE_PRICE_ID_STARTER,
    features: [
      '3 database connections',
      '10,000 requests/day',
      'Read-only access',
      'Email support',
    ],
  },
  lifetime: {
    name: 'Lifetime',
    price: 69,
    priceId: process.env.STRIPE_PRICE_ID_LIFETIME,
    features: [
      '2 database connections',
      '10,000 requests/day',
      'Read-only access',
      'Email support',
      'Lifetime updates',
    ],
  },
  // Public Annual SKU — replaces the Lifetime offer on the marketing
  // site. Same access tier as Starter but billed yearly at a discount
  // (~35% off monthly).
  // Create the recurring price in the Stripe Dashboard and set
  // STRIPE_PRICE_ID_ANNUAL on the app service.
  annual: {
    name: 'Annual',
    price: 149,
    priceId: process.env.STRIPE_PRICE_ID_ANNUAL,
    features: [
      '3 database connections',
      '10,000 requests/day',
      'Read-only access',
      'Email support',
      'All updates included',
    ],
  },
  pro: {
    name: 'Pro',
    price: 99,
    priceId: process.env.STRIPE_PRICE_ID_PRO,
    features: [
      'Unlimited credentials',
      '100,000 requests/day',
      'Read + Write access',
      'Priority support',
      'Advanced analytics',
    ],
  },
  team: {
    name: 'Team',
    price: 299,
    priceId: process.env.STRIPE_PRICE_ID_TEAM,
    features: [
      'Everything in Pro',
      'Unlimited requests',
      'SSO & SAML',
      'Dedicated support',
      'SLA guarantee',
      'Custom integrations',
    ],
  },
} as const

export type PlanType = keyof typeof PLANS
