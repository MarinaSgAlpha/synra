import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

// GET — list MCP endpoints for the current user's organization
export async function GET() {
  try {
    const supabase = await createServerClient()
    const admin = createAdminClient()

    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's organization (admin client bypasses RLS)
    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', authUser.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'No organization found' }, { status: 404 })
    }

    // Get endpoints with their associated credential names
    const { data: endpoints, error } = await admin
      .from('mcp_endpoints')
      .select(`
        id,
        endpoint_url,
        service_slug,
        is_active,
        rate_limit,
        allowed_tools,
        created_at,
        last_accessed_at,
        credentials!inner(id, name)
      `)
      .eq('organization_id', membership.organization_id)
      .order('created_at', { ascending: false })

    if (error) throw error

    // Flatten credentials object
    const formattedEndpoints = (endpoints || []).map((ep: any) => ({
      id: ep.id,
      endpoint_url: ep.endpoint_url,
      service_slug: ep.service_slug,
      is_active: ep.is_active,
      rate_limit: ep.rate_limit,
      allowed_tools: ep.allowed_tools,
      created_at: ep.created_at,
      last_accessed_at: ep.last_accessed_at,
      credential_name: ep.credentials?.name || 'Unknown',
    }))

    return NextResponse.json({ endpoints: formattedEndpoints })
  } catch (error: any) {
    console.error('GET endpoints error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
