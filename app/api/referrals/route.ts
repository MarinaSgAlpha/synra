import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { ensureReferralCode, REWARD_CAP_PER_YEAR } from '@/lib/referrals'

// GET — the current org's referral link + stats for the billing page
export async function GET() {
  try {
    const supabase = await createServerClient()
    const admin = createAdminClient()

    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', authUser.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'No organization found' }, { status: 404 })
    }

    const code = await ensureReferralCode(admin, membership.organization_id)

    const { data: referrals } = await admin
      .from('referrals')
      .select('status, reward_amount_cents, rewarded_at')
      .eq('referrer_organization_id', membership.organization_id)

    const all = referrals || []
    const rewarded = all.filter((r: any) => r.status === 'rewarded')
    const totalCreditCents = rewarded.reduce(
      (sum: number, r: any) => sum + (r.reward_amount_cents || 0),
      0
    )

    const yearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000
    const rewardedThisYear = rewarded.filter(
      (r: any) => r.rewarded_at && new Date(r.rewarded_at).getTime() >= yearAgo
    ).length

    return NextResponse.json({
      code,
      link: `https://app.mcpserver.design/login?ref=${code}`,
      signed_up: all.length,
      rewarded: rewarded.length,
      total_credit_cents: totalCreditCents,
      rewards_this_year: rewardedThisYear,
      yearly_cap: REWARD_CAP_PER_YEAR,
    })
  } catch (error: any) {
    console.error('GET /api/referrals error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
