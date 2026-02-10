import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/encryption'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const MAX_TEST_QUERIES = 3

// POST — Execute a test query to show value (max 3 free queries)
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const admin = createAdminClient()

    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { credentialId } = await request.json()
    if (!credentialId) {
      return NextResponse.json({ error: 'Credential ID required' }, { status: 400 })
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

    // Get credential
    const { data: credential } = await admin
      .from('credentials')
      .select('*')
      .eq('id', credentialId)
      .eq('organization_id', membership.organization_id)
      .single()

    if (!credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    // Check if user has paid subscription
    const { data: subscription } = await admin
      .from('subscriptions')
      .select('stripe_subscription_id, status')
      .eq('organization_id', membership.organization_id)
      .single()

    const hasPaidSubscription = subscription?.stripe_subscription_id && subscription.status === 'active'

    // If not paid, check test query limit
    if (!hasPaidSubscription) {
      const testQueriesUsed = credential.test_queries_used || 0
      
      if (testQueriesUsed >= MAX_TEST_QUERIES) {
        return NextResponse.json({ 
          error: 'Test query limit reached. Subscribe to continue.',
          limit_reached: true,
        }, { status: 403 })
      }

      // Increment test query counter
      await admin
        .from('credentials')
        .update({ test_queries_used: testQueriesUsed + 1 })
        .eq('id', credentialId)
    }

    // Decrypt config
    const decryptedConfig: Record<string, string> = {}
    for (const [key, value] of Object.entries(credential.config as Record<string, string>)) {
      if (typeof value === 'string' && value.length > 0) {
        try {
          decryptedConfig[key] = decrypt(value)
        } catch {
          decryptedConfig[key] = value
        }
      }
    }

    // Get Supabase URL and key
    const supabaseUrl = decryptedConfig.url || decryptedConfig.supabase_url || decryptedConfig.project_url
    const apiKey = decryptedConfig.service_role_key || decryptedConfig.api_key || decryptedConfig.anon_key || decryptedConfig.key

    if (!supabaseUrl || !apiKey) {
      return NextResponse.json({ error: 'Incomplete credentials' }, { status: 400 })
    }

    // Create Supabase client and test connection
    try {
      const customerClient = createClient(supabaseUrl, apiKey, {
        auth: { persistSession: false }
      })
      
      // Test connection with a simple query to get schema info using RPC
      // We'll call a PostgreSQL function to list tables
      const { data, error } = await customerClient.rpc('get_schema_info', {})
      
      // If RPC fails (function doesn't exist), try a simple query on any existing table
      if (error) {
        // Fallback: just test if we can connect by querying auth schema
        const { error: authError } = await customerClient.auth.getSession()
        
        if (authError && authError.message.includes('Invalid')) {
          return NextResponse.json({
            success: false,
            error: 'Invalid credentials or connection refused',
            details: authError.message,
          })
        }

        // Connection works but no custom RPC - that's OK
        const remainingQueries = hasPaidSubscription 
          ? 'unlimited' 
          : MAX_TEST_QUERIES - (credential.test_queries_used || 0) - 1

        return NextResponse.json({
          success: true,
          message: 'Connection successful! ✅',
          sample_data: {
            connection_verified: true,
            note: 'Connection established. Full query testing available after subscription.',
          },
          remaining_test_queries: remainingQueries,
        })
      }

      const remainingQueries = hasPaidSubscription 
        ? 'unlimited' 
        : MAX_TEST_QUERIES - (credential.test_queries_used || 0) - 1

      return NextResponse.json({
        success: true,
        message: 'Connection successful! ✅',
        sample_data: {
          schema_info: data,
          connection_verified: true,
        },
        remaining_test_queries: remainingQueries,
      })
    } catch (err: any) {
      return NextResponse.json({
        success: false,
        error: 'Connection test failed',
        details: err.message,
      })
    }
  } catch (error: any) {
    console.error('Test connection error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
