import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// PATCH — update organization settings
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const admin = createAdminClient()

    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { name, company_size, user_name } = await request.json()

    // Get user's organization
    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', authUser.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'No organization found' }, { status: 404 })
    }

    // Only owners and admins can update org settings
    if (!['owner', 'admin'].includes(membership.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    // Build update object
    const updates: Record<string, any> = {}
    if (name !== undefined) updates.name = name
    if (company_size !== undefined) updates.company_size = company_size
    updates.updated_at = new Date().toISOString()

    const { data: org, error } = await admin
      .from('organizations')
      .update(updates)
      .eq('id', membership.organization_id)
      .select()
      .single()

    if (error) throw error

    // Update user name if provided
    if (user_name !== undefined) {
      await admin
        .from('users')
        .update({ name: user_name, updated_at: new Date().toISOString() })
        .eq('id', authUser.id)
    }

    return NextResponse.json({ organization: org })
  } catch (error: any) {
    console.error('PATCH organization error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
