import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripe, PLANS } from '@/lib/stripe/config'
import { NextRequest, NextResponse } from 'next/server'
import { DEFAULT_TRIAL_DAYS, REFERRAL_TRIAL_DAYS } from '@/lib/referrals'

// POST — Create a Stripe Checkout session for upgrading a plan
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

    // Get organization and subscription
    const { data: org } = await admin
      .from('organizations')
      .select('id, name, slug, referred_by_organization_id')
      .eq('id', membership.organization_id)
      .single()

    const { data: subscription } = await admin
      .from('subscriptions')
      .select('*')
      .eq('organization_id', membership.organization_id)
      .single()

    if (!org || !subscription) {
      return NextResponse.json({ error: 'Organization or subscription not found' }, { status: 404 })
    }

    // Parse request body
    const { plan } = await request.json()
    if (
      !plan ||
      !['solo', 'starter', 'annual', 'pro', 'team', 'lifetime'].includes(plan)
    ) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }

    const planConfig = PLANS[plan as keyof typeof PLANS]
    if (!planConfig.priceId) {
      return NextResponse.json({ error: 'Plan not configured' }, { status: 500 })
    }

    // Create or retrieve Stripe customer
    let customerId = subscription.stripe_customer_id

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: authUser.email!,
        name: org.name,
        metadata: {
          organization_id: org.id,
          organization_slug: org.slug,
        },
      })
      customerId = customer.id

      // Update subscription with customer ID
      await admin
        .from('subscriptions')
        .update({ stripe_customer_id: customerId })
        .eq('id', subscription.id)
    }

    // Create Checkout Session
    const origin = request.headers.get('origin') || 'http://localhost:3000'
    
    // Lifetime is one-time payment, others are subscriptions
    const mode = plan === 'lifetime' ? 'payment' : 'subscription'
    
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode,
      payment_method_types: ['card'],
      line_items: [
        {
          price: planConfig.priceId,
          quantity: 1,
        },
      ],
      // Referral/promo codes can be entered at checkout (used later by the
      // referral program; harmless when no promotions exist).
      allow_promotion_codes: true,
      // Solo gets a 7-day trial so marketing can keep a "start free"
      // claim; referred signups get 14 days as the referee-side reward.
      ...(mode === 'subscription' && plan === 'solo'
        ? {
            subscription_data: {
              trial_period_days: org.referred_by_organization_id
                ? REFERRAL_TRIAL_DAYS
                : DEFAULT_TRIAL_DAYS,
            },
          }
        : {}),
      success_url: `${origin}/dashboard?upgrade=success`,
      cancel_url: `${origin}/dashboard?upgrade=canceled`,
      metadata: {
        organization_id: org.id,
        plan,
      },
    })

    return NextResponse.json({ url: session.url })
  } catch (error: any) {
    console.error('Create checkout session error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
