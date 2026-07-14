import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { cookies } from 'next/headers'
import { generateReferralCode, recordReferralSignup, REFERRAL_COOKIE } from '@/lib/referrals'

// GET — fetch current user's profile + organization
// If user/org records don't exist yet (e.g. signup partially failed), create them
export async function GET() {
  try {
    const supabase = await createServerClient()
    const admin = createAdminClient()

    // Get auth user from session
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Try to fetch user record
    let { data: user } = await admin
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single()

    // If user record doesn't exist, create it + org + membership + subscription
    if (!user) {
      const name = authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'User'
      const companyName = authUser.user_metadata?.company_name
      const email = authUser.email || ''
      const orgSlug = `org-${nanoid(10)}`

      // Create organization (use company name if available)
      const orgName = companyName || `${name}'s Organization`
      const { data: org, error: orgError } = await admin
        .from('organizations')
        .insert({
          name: orgName,
          slug: orgSlug,
          referral_code: generateReferralCode(),
        })
        .select()
        .single()

      if (orgError) throw new Error(`Failed to create organization: ${orgError.message}`)

      // Link to referrer if the login page captured a ?ref= code.
      try {
        const cookieStore = await cookies()
        await recordReferralSignup(admin, org.id, cookieStore.get(REFERRAL_COOKIE)?.value)
      } catch (refError) {
        console.error('Referral signup tracking failed:', refError)
      }

      // Create user record with id = auth user id
      const { data: newUser, error: userError } = await admin
        .from('users')
        .insert({
          id: authUser.id,
          email,
          name,
        })
        .select()
        .single()

      if (userError) throw new Error(`Failed to create user: ${userError.message}`)

      user = newUser

      // Create organization membership
      await admin
        .from('organization_members')
        .insert({
          organization_id: org.id,
          user_id: user.id,
          role: 'owner',
          status: 'active',
          joined_at: new Date().toISOString(),
        })

      // Bootstrap subscription row. 'free' matches the org default —
      // post-cutoff orgs have no product access until they subscribe.
      await admin
        .from('subscriptions')
        .insert({
          organization_id: org.id,
          plan: 'free',
          status: 'active',
        })

      return NextResponse.json({ user, organization: org })
    }

    // User exists — fetch organization and subscription
    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', user.id)
      .single()

    let organization = null
    let subscription = null
    
    if (membership) {
      const { data: org } = await admin
        .from('organizations')
        .select('*')
        .eq('id', membership.organization_id)
        .single()

      const { data: sub } = await admin
        .from('subscriptions')
        .select(
          'stripe_customer_id, stripe_subscription_id, status, plan, current_period_start, current_period_end, cancel_at_period_end'
        )
        .eq('organization_id', membership.organization_id)
        .single()

      organization = org
      subscription = sub
    }

    return NextResponse.json({ user, organization, subscription })
  } catch (error: any) {
    console.error('GET /api/auth/me error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
