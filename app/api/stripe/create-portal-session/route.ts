import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripe, PLANS } from '@/lib/stripe/config'
import { NextRequest, NextResponse } from 'next/server'

// Plans a paying customer can switch to from the Billing page. These are the
// three that are sold today and allowed in the Stripe portal configuration.
const SWITCHABLE_PLANS = ['solo', 'starter', 'annual'] as const
type SwitchablePlan = (typeof SWITCHABLE_PLANS)[number]

// POST — Create a Stripe Customer Portal session for managing billing
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const admin = createAdminClient()

    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's organization
    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', authUser.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'No organization found' }, { status: 404 })
    }

    // Optional body: { plan } deep-links the portal to the "confirm plan
    // change" step so the customer picks on our Billing page and only
    // confirms on Stripe. Without it, the portal opens on its home page.
    let targetPlan: string | undefined
    try {
      const body = await request.json()
      if (typeof body?.plan === 'string') targetPlan = body.plan
    } catch {
      /* no body: normal "Manage Billing" */
    }

    // Get subscription
    const { data: subscription } = await admin
      .from('subscriptions')
      .select('stripe_customer_id, stripe_subscription_id, plan')
      .eq('organization_id', membership.organization_id)
      .single()

    if (!subscription?.stripe_customer_id) {
      return NextResponse.json({ error: 'No Stripe customer found' }, { status: 404 })
    }

    const origin = request.headers.get('origin') || 'http://localhost:3000'

    // Deep link to a specific plan change
    if (targetPlan) {
      if (!SWITCHABLE_PLANS.includes(targetPlan as SwitchablePlan)) {
        return NextResponse.json({ error: 'That plan cannot be selected here' }, { status: 400 })
      }
      const targetPriceId = PLANS[targetPlan as SwitchablePlan].priceId
      if (!targetPriceId) {
        return NextResponse.json({ error: 'That plan is not available right now' }, { status: 400 })
      }
      if (!subscription.stripe_subscription_id) {
        return NextResponse.json({ error: 'No active subscription to change' }, { status: 400 })
      }
      if (subscription.plan === targetPlan) {
        return NextResponse.json({ error: 'You are already on that plan' }, { status: 400 })
      }

      const stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id)
      const item = stripeSub.items.data[0]
      if (
        !item ||
        stripeSub.customer !== subscription.stripe_customer_id ||
        !['active', 'trialing'].includes(stripeSub.status)
      ) {
        return NextResponse.json({ error: 'No active subscription to change' }, { status: 400 })
      }

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: subscription.stripe_customer_id,
        return_url: `${origin}/dashboard/billing`,
        flow_data: {
          type: 'subscription_update_confirm',
          subscription_update_confirm: {
            subscription: stripeSub.id,
            items: [{ id: item.id, price: targetPriceId, quantity: 1 }],
          },
          after_completion: {
            type: 'redirect',
            redirect: { return_url: `${origin}/dashboard/billing` },
          },
        },
      })
      return NextResponse.json({ url: portalSession.url })
    }

    // Create portal session (home page)
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${origin}/dashboard/settings`,
    })

    return NextResponse.json({ url: portalSession.url })
  } catch (error: any) {
    console.error('Create portal session error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
