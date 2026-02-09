import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { encrypt } from '@/lib/encryption'
import { NextRequest, NextResponse } from 'next/server'
import { nanoid } from 'nanoid'

// GET — list credentials for the current user's organization
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

    // Get credentials (without sensitive config data)
    const { data: credentials, error } = await admin
      .from('credentials')
      .select('id, organization_id, service_slug, name, is_active, created_at, updated_at, last_used_at')
      .eq('organization_id', membership.organization_id)
      .order('created_at', { ascending: false })

    if (error) throw error

    return NextResponse.json({ credentials })
  } catch (error: any) {
    console.error('GET credentials error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST — create a new credential + auto-generate MCP endpoint
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const admin = createAdminClient()

    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { name, serviceSlug, config } = await request.json()

    if (!name || !serviceSlug || !config) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
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

    // Encrypt sensitive config values
    const encryptedConfig: Record<string, string> = {}
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string' && value.length > 0) {
        encryptedConfig[key] = encrypt(value as string)
      }
    }

    // Create credential using admin client (bypasses RLS)
    const { data: credential, error: credError } = await admin
      .from('credentials')
      .insert({
        organization_id: membership.organization_id,
        service_slug: serviceSlug,
        name,
        config: encryptedConfig,
        is_active: true,
        created_by: authUser.id,
      })
      .select()
      .single()

    if (credError) throw new Error(`Failed to create credential: ${credError.message}`)

    // Auto-generate MCP endpoint
    const endpointId = nanoid(20)
    const endpointUrl = `/api/mcp/${endpointId}`

    const { data: endpoint, error: endpointError } = await admin
      .from('mcp_endpoints')
      .insert({
        organization_id: membership.organization_id,
        credential_id: credential.id,
        service_slug: serviceSlug,
        endpoint_url: endpointUrl,
        is_active: true,
      })
      .select()
      .single()

    if (endpointError) throw new Error(`Failed to create endpoint: ${endpointError.message}`)

    return NextResponse.json({
      credential: {
        id: credential.id,
        name: credential.name,
        service_slug: credential.service_slug,
        is_active: credential.is_active,
        created_at: credential.created_at,
      },
      endpoint: {
        id: endpoint.id,
        endpoint_url: endpoint.endpoint_url,
      },
    })
  } catch (error: any) {
    console.error('POST credentials error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
