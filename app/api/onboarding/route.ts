import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST — save onboarding answers and mark onboarding complete.
 *
 * Runs for both signup methods (Google OAuth + email/password) after first
 * login. The signed-in user is always the owner of the org created at signup,
 * so we resolve their org from membership rather than trusting a client id.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const admin = createAdminClient()

    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const {
      company_name,
      user_name,
      company_size,
      industry,
      use_case,
      referral_source,
    } = await request.json()

    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', authUser.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'No organization found' }, { status: 404 })
    }

    const now = new Date().toISOString()

    const orgUpdates: Record<string, any> = {
      onboarding_completed_at: now,
      updated_at: now,
    }
    if (company_name) orgUpdates.name = company_name
    if (company_size !== undefined) orgUpdates.company_size = company_size || null
    if (industry !== undefined) orgUpdates.industry = industry || null
    if (use_case !== undefined) orgUpdates.use_case = use_case || null
    if (referral_source !== undefined)
      orgUpdates.referral_source = referral_source || null

    const { data: org, error: orgError } = await admin
      .from('organizations')
      .update(orgUpdates)
      .eq('id', membership.organization_id)
      .select()
      .single()

    if (orgError) throw orgError

    if (user_name) {
      await admin
        .from('users')
        .update({ name: user_name, updated_at: now })
        .eq('id', authUser.id)
    }

    return NextResponse.json({ organization: org })
  } catch (error: any) {
    console.error('POST onboarding error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
