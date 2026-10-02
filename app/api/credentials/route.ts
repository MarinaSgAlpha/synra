import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { encrypt } from '@/lib/encryption'
import { NextRequest, NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { INSTRUCTIONS_KEY, MAX_INSTRUCTIONS_LENGTH, normalizeInstructions } from '@/lib/connection-instructions'

/**
 * Validate and store the optional per-connection instructions on the
 * processed config. Returns an error message when the value is too long.
 * Empty / whitespace-only values are removed so they never reach storage.
 */
function applyInstructions(
  submitted: Record<string, unknown>,
  processed: Record<string, string>
): string | null {
  const raw = submitted[INSTRUCTIONS_KEY]
  if (typeof raw === 'string' && raw.trim().length > MAX_INSTRUCTIONS_LENGTH) {
    return `Instructions are too long (${raw.trim().length} characters). The limit is ${MAX_INSTRUCTIONS_LENGTH}.`
  }
  const value = normalizeInstructions(raw)
  if (value) {
    processed[INSTRUCTIONS_KEY] = value
  } else {
    delete processed[INSTRUCTIONS_KEY]
  }
  return null
}

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
      .select('id, organization_id, service_slug, name, is_active, created_at, updated_at, last_used_at, test_queries_used')
      .eq('organization_id', membership.organization_id)
      .order('created_at', { ascending: false })

    if (error) throw error

    // Fetch endpoint URLs for each credential
    const credentialIds = (credentials || []).map((c: any) => c.id)
    let endpoints: any[] = []

    if (credentialIds.length > 0) {
      const { data: endpointData } = await admin
        .from('mcp_endpoints')
        .select('credential_id, endpoint_url, rate_limit, last_accessed_at, created_at')
        .in('credential_id', credentialIds)

      endpoints = endpointData || []
    }

    // Merge endpoint data into credentials
    const credentialsWithEndpoints = (credentials || []).map((cred: any) => {
      const endpoint = endpoints.find((e: any) => e.credential_id === cred.id)
      return {
        ...cred,
        endpoint_url: endpoint?.endpoint_url || null,
        rate_limit: endpoint?.rate_limit || null,
        last_accessed_at: endpoint?.last_accessed_at || null,
        endpoint_created_at: endpoint?.created_at || null,
      }
    })

    return NextResponse.json({ credentials: credentialsWithEndpoints })
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

    // Check if organization can create more credentials (plan limit)
    const { canCreateCredential } = await import('@/lib/usage-limits')
    const usageCheck = await canCreateCredential(membership.organization_id)
    
    if (!usageCheck.allowed) {
      return NextResponse.json({ 
        error: usageCheck.reason || 'Cannot create credential',
        upgrade_required: true,
        ...(usageCheck.subscription_required ? { subscription_required: true } : {}),
      }, { status: 403 })
    }

    // Get service schema to determine which fields to encrypt
    const { data: service } = await admin
      .from('supported_services')
      .select('config_schema')
      .eq('slug', serviceSlug)
      .single()

    const encryptedFields = new Set<string>()
    if (service?.config_schema?.fields) {
      for (const field of service.config_schema.fields) {
        if (field.encrypted) {
          encryptedFields.add(field.key)
        }
      }
    }

    // Encrypt only sensitive config values (based on schema)
    const processedConfig: Record<string, string> = {}
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string' && value.length > 0) {
        processedConfig[key] = encryptedFields.has(key) ? encrypt(value as string) : value
      }
    }

    // Per-connection AI instructions: plain text, trimmed, length-capped
    const instructionsError = applyInstructions(config, processedConfig)
    if (instructionsError) {
      return NextResponse.json({ error: instructionsError }, { status: 400 })
    }

    // Create credential using admin client (bypasses RLS)
    const { data: credential, error: credError } = await admin
      .from('credentials')
      .insert({
        organization_id: membership.organization_id,
        service_slug: serviceSlug,
        name,
        config: processedConfig,
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

// PATCH — update an existing credential
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const admin = createAdminClient()

    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id, name, config } = await request.json()

    if (!id || !name || !config) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
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

    // Verify the credential belongs to this organization
    const { data: existingCred } = await admin
      .from('credentials')
      .select('id, organization_id, service_slug, config')
      .eq('id', id)
      .eq('organization_id', membership.organization_id)
      .single()

    if (!existingCred) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    // Get service schema to determine which fields to encrypt
    const { data: service } = await admin
      .from('supported_services')
      .select('config_schema')
      .eq('slug', existingCred.service_slug)
      .single()

    const encryptedFields = new Set<string>()
    if (service?.config_schema?.fields) {
      for (const field of service.config_schema.fields) {
        if (field.encrypted) {
          encryptedFields.add(field.key)
        }
      }
    }

    // Encrypt only sensitive config values (based on schema)
    const processedConfig: Record<string, string> = {}
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string' && value.length > 0) {
        processedConfig[key] = encryptedFields.has(key) ? encrypt(value as string) : value
      }
    }

    // Per-connection AI instructions: plain text, trimmed, length-capped.
    // Submitting an empty value clears them.
    const instructionsError = applyInstructions(config, processedConfig)
    if (instructionsError) {
      return NextResponse.json({ error: instructionsError }, { status: 400 })
    }

    // The edit form only knows the schema fields, so it never sends
    // allowed_tables. Without this, saving an edit silently wiped the
    // connection's table restrictions and exposed every table.
    const existingConfig = (existingCred.config || {}) as Record<string, unknown>
    if (processedConfig.allowed_tables === undefined && typeof existingConfig.allowed_tables === 'string') {
      processedConfig.allowed_tables = existingConfig.allowed_tables
    }

    // Update credential
    const { data: credential, error: credError } = await admin
      .from('credentials')
      .update({
        name,
        config: processedConfig,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (credError) throw new Error(`Failed to update credential: ${credError.message}`)

    return NextResponse.json({
      credential: {
        id: credential.id,
        name: credential.name,
        service_slug: credential.service_slug,
        is_active: credential.is_active,
        created_at: credential.created_at,
        updated_at: credential.updated_at,
      },
    })
  } catch (error: any) {
    console.error('PATCH credentials error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE — delete a credential and its associated endpoint
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const admin = createAdminClient()

    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await request.json()

    if (!id) {
      return NextResponse.json({ error: 'Missing credential ID' }, { status: 400 })
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

    // Verify the credential belongs to this organization
    const { data: existingCred } = await admin
      .from('credentials')
      .select('id, organization_id')
      .eq('id', id)
      .eq('organization_id', membership.organization_id)
      .single()

    if (!existingCred) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    // Delete associated MCP endpoints first (foreign key constraint)
    await admin
      .from('mcp_endpoints')
      .delete()
      .eq('credential_id', id)

    // Delete the credential
    const { error: deleteError } = await admin
      .from('credentials')
      .delete()
      .eq('id', id)

    if (deleteError) throw new Error(`Failed to delete credential: ${deleteError.message}`)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('DELETE credentials error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
