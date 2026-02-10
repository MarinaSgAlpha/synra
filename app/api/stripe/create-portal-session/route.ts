import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripe } from '@/lib/stripe/config'
import { NextRequest, NextResponse } from 'next/server'

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

    // Get subscription
    const { data: subscription } = await admin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('organization_id', membership.organization_id)
      .single()

    if (!subscription?.stripe_customer_id) {
      return NextResponse.json({ error: 'No Stripe customer found' }, { status: 404 })
    }

    // Create portal session
    const origin = request.headers.get('origin') || 'http://localhost:3000'
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
