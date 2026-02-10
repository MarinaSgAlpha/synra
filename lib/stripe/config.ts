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

// Pricing plans
export const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    priceId: null,
    features: [
      '1 credential',
      '100 requests/day',
      'Read-only access',
      'Basic support',
    ],
  },
  starter: {
    name: 'Starter',
    price: 29,
    priceId: process.env.STRIPE_PRICE_ID_STARTER,
    features: [
      '5 credentials',
      '10,000 requests/day',
      'Read-only access',
      'Email support',
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
