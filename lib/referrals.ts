import { customAlphabet } from 'nanoid'

/**
 * Referral program ("give a month, get a month"):
 *  - Every org gets a shareable code; the link points at /login?ref=CODE.
 *  - The login page stores the code in a cookie so it survives the
 *    Google OAuth round-trip, and org creation links the new org to the
 *    referrer (organizations.referred_by_organization_id + referrals row).
 *  - Referred orgs get a 14-day Solo trial instead of 7.
 *  - When a referred org pays its first real (non-$0) invoice, the
 *    referrer's Stripe customer balance is credited one month of their
 *    own plan, capped at REWARD_CAP_PER_YEAR rewards per rolling year.
 */

export const REFERRAL_COOKIE = 'synra_ref'
export const REFERRAL_TRIAL_DAYS = 14
export const DEFAULT_TRIAL_DAYS = 7
export const REWARD_CAP_PER_YEAR = 12

// Unambiguous lowercase alphanumerics (no l/1/o/0) so codes are easy to
// read aloud and retype.
const codeAlphabet = customAlphabet('abcdefghijkmnpqrstuvwxyz23456789', 8)

export function generateReferralCode(): string {
  return codeAlphabet()
}

/** One month of the referrer's plan, in cents. Annual is prorated to a
 * monthly equivalent. Unknown/free plans get the Solo value — the credit
 * sits on their Stripe balance and applies whenever they subscribe. */
export function monthlyPlanValueCents(plan: string | null | undefined): number {
  switch (plan) {
    case 'starter':
      return 1900
    case 'annual':
      return 1242 // $149 / 12
    case 'pro':
      return 9900
    case 'team':
      return 29900
    default:
      return 999 // solo, free, and anything else
  }
}

/** Get the org's referral code, generating and persisting one if missing
 * (covers orgs created before the referral program existed). */
export async function ensureReferralCode(admin: any, organizationId: string): Promise<string> {
  const { data: org } = await admin
    .from('organizations')
    .select('referral_code')
    .eq('id', organizationId)
    .single()

  if (org?.referral_code) return org.referral_code

  // Retry a couple of times in the (vanishingly unlikely) event of a
  // unique-constraint collision on the generated code.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateReferralCode()
    const { error } = await admin
      .from('organizations')
      .update({ referral_code: code })
      .eq('id', organizationId)
      .is('referral_code', null)
    if (!error) return code
  }
  throw new Error('Failed to generate referral code')
}

/**
 * Link a freshly created org to its referrer. Called from both org
 * creation paths (setup-user and the auth/me fallback). Silently no-ops
 * on unknown codes so a stale cookie never breaks signup.
 */
export async function recordReferralSignup(
  admin: any,
  newOrganizationId: string,
  refCode: string | null | undefined
): Promise<void> {
  if (!refCode) return

  const { data: referrer } = await admin
    .from('organizations')
    .select('id')
    .eq('referral_code', refCode)
    .single()

  if (!referrer || referrer.id === newOrganizationId) return

  await admin
    .from('organizations')
    .update({ referred_by_organization_id: referrer.id })
    .eq('id', newOrganizationId)

  // referred_organization_id is unique — a duplicate insert (e.g. webhook
  // retry or double signup call) fails quietly, which is what we want.
  await admin.from('referrals').insert({
    referrer_organization_id: referrer.id,
    referred_organization_id: newOrganizationId,
    status: 'signed_up',
  })
}

/**
 * Credit the referrer one month of their plan after the referred org pays
 * a real invoice. Idempotent per referred org (status flips to 'rewarded').
 * If the referrer can't be credited yet (no Stripe customer, or over the
 * yearly cap) the referral stays 'signed_up' and is retried on the
 * referred org's next paid invoice.
 */
export async function rewardReferralIfEligible(
  admin: any,
  stripe: any,
  referredOrganizationId: string
): Promise<void> {
  const { data: referral } = await admin
    .from('referrals')
    .select('id, referrer_organization_id')
    .eq('referred_organization_id', referredOrganizationId)
    .eq('status', 'signed_up')
    .single()

  if (!referral) return

  // Rolling-year cap
  const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
  const { count: rewardedThisYear } = await admin
    .from('referrals')
    .select('*', { count: 'exact', head: true })
    .eq('referrer_organization_id', referral.referrer_organization_id)
    .eq('status', 'rewarded')
    .gte('rewarded_at', yearAgo)

  if ((rewardedThisYear || 0) >= REWARD_CAP_PER_YEAR) {
    console.log(`Referral reward skipped (yearly cap) for org ${referral.referrer_organization_id}`)
    return
  }

  const { data: referrerSub } = await admin
    .from('subscriptions')
    .select('stripe_customer_id, plan')
    .eq('organization_id', referral.referrer_organization_id)
    .single()

  if (!referrerSub?.stripe_customer_id) {
    // No Stripe customer to credit yet — retried on the next paid invoice.
    console.log(`Referral reward deferred (no Stripe customer) for org ${referral.referrer_organization_id}`)
    return
  }

  const amountCents = monthlyPlanValueCents(referrerSub.plan)

  // Negative balance = credit applied to future invoices.
  await stripe.customers.createBalanceTransaction(referrerSub.stripe_customer_id, {
    amount: -amountCents,
    currency: 'usd',
    description: 'Referral reward — 1 month free',
  })

  await admin
    .from('referrals')
    .update({
      status: 'rewarded',
      reward_amount_cents: amountCents,
      rewarded_at: new Date().toISOString(),
    })
    .eq('id', referral.id)

  console.log(
    `✅ Referral reward: credited ${amountCents}¢ to org ${referral.referrer_organization_id} for referred org ${referredOrganizationId}`
  )
}
