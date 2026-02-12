import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// GET — fetch a single credential by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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

    // Fetch the credential (includes config)
    const { data: credential, error } = await admin
      .from('credentials')
      .select('id, organization_id, service_slug, name, config, is_active, created_at, updated_at')
      .eq('id', id)
      .eq('organization_id', membership.organization_id)
      .single()

    if (error || !credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    return NextResponse.json({ credential })
  } catch (error: any) {
    console.error('GET credential error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
