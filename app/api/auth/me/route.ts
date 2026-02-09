import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { nanoid } from 'nanoid'

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
      const email = authUser.email || ''
      const orgSlug = `org-${nanoid(10)}`

      // Create organization
      const { data: org, error: orgError } = await admin
        .from('organizations')
        .insert({
          name: `${name}'s Organization`,
          slug: orgSlug,
        })
        .select()
        .single()

      if (orgError) throw new Error(`Failed to create organization: ${orgError.message}`)

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

      // Create free subscription
      await admin
        .from('subscriptions')
        .insert({
          organization_id: org.id,
          plan: 'free',
          status: 'active',
        })

      return NextResponse.json({ user, organization: org })
    }

    // User exists — fetch organization
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
