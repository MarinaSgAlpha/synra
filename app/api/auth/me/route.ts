import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

// GET — fetch current user's profile + organization (bypasses RLS)
export async function GET() {
  try {
    const supabase = await createServerClient()
    const admin = createAdminClient()

    // Get auth user from session
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch user record using admin client (bypasses RLS)
    const { data: user } = await admin
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single()

    if (!user) {
      return NextResponse.json({ error: 'User record not found' }, { status: 404 })
    }

    // Fetch organization membership
    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', user.id)
      .single()

    let organization = null
    if (membership) {
      const { data: org } = await admin
        .from('organizations')
        .select('*')
        .eq('id', membership.organization_id)
        .single()

      organization = org
    }

    return NextResponse.json({ user, organization })
  } catch (error: any) {
    console.error('GET /api/auth/me error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
