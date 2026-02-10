# Stripe Integration Setup Guide

## 1. Create Stripe Account & Get API Keys

1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. Navigate to **Developers** → **API keys**
3. Copy your **Secret key** (starts with `sk_test_...` for test mode)
4. Copy your **Publishable key** (not needed for server-side only)

## 2. Create Products & Prices

Create three subscription products in Stripe:

### Starter Plan ($19/month)
1. Go to **Products** → **Add Product**
2. Name: "Starter"
3. Pricing: Recurring, $19 USD, Monthly
4. Save and copy the **Price ID** (starts with `price_...`)

### Pro Plan ($99/month)
1. Create another product
2. Name: "Pro"
3. Pricing: Recurring, $99 USD, Monthly
4. Copy the **Price ID**

### Team Plan ($299/month)
1. Create another product
2. Name: "Team"
3. Pricing: Recurring, $299 USD, Monthly
4. Copy the **Price ID**

## 3. Set Up Webhooks

1. Go to **Developers** → **Webhooks**
2. Click **Add endpoint**
3. Endpoint URL: `https://app.mcpserver.design/api/stripe/webhook`
4. Listen to events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Copy the **Signing secret** (starts with `whsec_...`)

## 4. Update Environment Variables

Add to your `.env.local`:

```env
# Stripe
STRIPE_SECRET_KEY=sk_test_...your_secret_key...
STRIPE_WEBHOOK_SECRET=whsec_...your_webhook_secret...

# Stripe Price IDs
STRIPE_PRICE_ID_STARTER=price_...starter_price_id...
STRIPE_PRICE_ID_PRO=price_...pro_price_id...
STRIPE_PRICE_ID_TEAM=price_...team_price_id...
```

## 5. Test the Integration

### Test Checkout Flow:
1. Log in to your dashboard at `http://localhost:3000/dashboard`
2. Go to **Settings**
3. Click **Upgrade** on any paid plan
4. Use Stripe test card: `4242 4242 4242 4242`
5. Any future expiry date, any CVC

### Test Webhook Locally:
Use Stripe CLI to forward webhooks to localhost:

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks
stripe listen --forward-to localhost:3000/api/stripe/webhook

# Trigger test events
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
```

## 6. Deploy to Production

1. Switch to **Live mode** in Stripe Dashboard
2. Create new products/prices for live mode
3. Get live API keys and webhook secret
4. Update environment variables in Railway/Netlify with **live** keys
5. Update webhook endpoint URL to production domain

## Current Plan Limits

| Plan | Price | Credentials | Daily Requests | Features |
|------|-------|-------------|----------------|----------|
| Starter | $19/mo | 5 | 10,000 | Read-only, Email support |
| Pro | $99/mo | Unlimited | 100,000 | Read+Write, Priority support, Analytics |
| Team | $299/mo | Unlimited | Unlimited | Everything + SSO, SLA, Dedicated support |

**Note:** No free tier. All new signups start on Starter plan.

## Troubleshooting

### Webhook not receiving events
- Check webhook signing secret is correct
- Verify endpoint URL is publicly accessible
- Check webhook logs in Stripe Dashboard

### Checkout session not redirecting
- Verify `success_url` and `cancel_url` are correct
- Check browser console for errors

### Plan not updating after payment
- Check webhook events were processed
- Look at `webhook_events` table in database
- Verify `processed` column is `true`
