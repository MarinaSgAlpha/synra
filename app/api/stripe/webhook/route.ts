import { stripe } from '@/lib/stripe/config'
import { createAdminClient } from '@/lib/supabase/admin'
import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

// Disable body parsing so we can verify the webhook signature
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = (await headers()).get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'No signature' }, { status: 400 })
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message)
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 })
  }

  const admin = createAdminClient()

  // Log webhook event
  await admin.from('webhook_events').insert({
    source: 'stripe',
    event_type: event.type,
    event_id: event.id,
    payload: event.data.object as any,
    processed: false,
  })

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        await handleCheckoutCompleted(session, admin)
        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        await handleSubscriptionUpdated(subscription, admin)
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        await handleSubscriptionDeleted(subscription, admin)
        break
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        await handleInvoicePaymentSucceeded(invoice, admin)
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        await handleInvoicePaymentFailed(invoice, admin)
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    // Mark webhook as processed
    await admin
      .from('webhook_events')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('event_id', event.id)

    return NextResponse.json({ received: true })
  } catch (error: any) {
    console.error('Webhook processing error:', error)

    // Log error in webhook_events
    await admin
      .from('webhook_events')
      .update({ error_message: error.message })
      .eq('event_id', event.id)

    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// Handle successful checkout
async function handleCheckoutCompleted(session: Stripe.Checkout.Session, admin: any) {
  const organizationId = session.metadata?.organization_id
  const plan = session.metadata?.plan

  if (!organizationId || !plan) {
    throw new Error('Missing organization_id or plan in session metadata')
  }

  const customerId = session.customer as string
  const paymentId = session.payment_intent as string || session.id

  // Lifetime is a one-time payment (mode: 'payment'), subscriptions have subscription IDs
  if (plan === 'lifetime') {
    // One-time payment for lifetime access
    await admin
      .from('subscriptions')
      .update({
        stripe_customer_id: customerId,
        stripe_subscription_id: null, // No recurring subscription
        status: 'active',
        plan: 'lifetime',
        updated_at: new Date().toISOString(),
      })
      .eq('organization_id', organizationId)

    await admin
      .from('organizations')
      .update({ plan: 'lifetime', updated_at: new Date().toISOString() })
      .eq('id', organizationId)

    console.log(`✅ Lifetime plan activated for org ${organizationId}`)
    
    // Track Reddit Purchase event (note: Reddit Conversions API would need to be set up for server-side)
    // For now, client-side tracking will happen when user returns to dashboard
  } else {
    // Recurring subscription (starter, pro, team)
    const subscriptionId = session.subscription as string

    await admin
      .from('subscriptions')
      .update({
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        status: 'active',
        plan,
        updated_at: new Date().toISOString(),
      })
      .eq('organization_id', organizationId)

    await admin
      .from('organizations')
      .update({ plan, updated_at: new Date().toISOString() })
      .eq('id', organizationId)

    console.log(`✅ Subscription activated for org ${organizationId}: ${plan}`)
  }
}

// Handle subscription updates
async function handleSubscriptionUpdated(subscription: Stripe.Subscription, admin: any) {
  const customerId = subscription.customer as string

  // Find subscription by customer ID
  const { data: sub } = await admin
    .from('subscriptions')
    .select('*')
    .eq('stripe_customer_id', customerId)
    .single()

  if (!sub) {
    console.warn(`No subscription found for customer ${customerId}`)
    return
  }

  const status = subscription.status
  const subData = subscription as any
  const currentPeriodStart = subData.current_period_start
    ? new Date(subData.current_period_start * 1000).toISOString()
    : null
  const currentPeriodEnd = subData.current_period_end
    ? new Date(subData.current_period_end * 1000).toISOString()
    : null
  const cancelAtPeriodEnd = subData.cancel_at_period_end || false

  await admin
    .from('subscriptions')
    .update({
      status,
      current_period_start: currentPeriodStart,
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: cancelAtPeriodEnd,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sub.id)

  console.log(`✅ Subscription updated for org ${sub.organization_id}: ${status}`)
}

// Handle subscription cancellation
async function handleSubscriptionDeleted(subscription: Stripe.Subscription, admin: any) {
  const customerId = subscription.customer as string

  const { data: sub } = await admin
    .from('subscriptions')
    .select('*')
    .eq('stripe_customer_id', customerId)
    .single()

  if (!sub) {
    console.warn(`No subscription found for customer ${customerId}`)
    return
  }

  // Downgrade to free plan
  await admin
    .from('subscriptions')
    .update({
      status: 'canceled',
      plan: 'free',
      stripe_subscription_id: null,
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sub.id)

  await admin
    .from('organizations')
    .update({ plan: 'free', updated_at: new Date().toISOString() })
    .eq('id', sub.organization_id)

  console.log(`✅ Subscription canceled for org ${sub.organization_id}, downgraded to free`)
}

// Handle successful invoice payment
async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice, admin: any) {
  const customerId = invoice.customer as string

  const { data: sub } = await admin
    .from('subscriptions')
    .select('*')
    .eq('stripe_customer_id', customerId)
    .single()

  if (!sub) return

  await admin
    .from('subscriptions')
    .update({
      status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', sub.id)

  console.log(`✅ Invoice paid for org ${sub.organization_id}`)
}

// Handle failed invoice payment
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice, admin: any) {
  const customerId = invoice.customer as string

  const { data: sub } = await admin
    .from('subscriptions')
    .select('*')
    .eq('stripe_customer_id', customerId)
    .single()

  if (!sub) return

  await admin
    .from('subscriptions')
    .update({
      status: 'past_due',
      updated_at: new Date().toISOString(),
    })
    .eq('id', sub.id)

  console.log(`⚠️ Invoice payment failed for org ${sub.organization_id}`)
}
