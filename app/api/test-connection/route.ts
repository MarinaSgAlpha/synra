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
      const customerClient = createClient(supabaseUrl, apiKey)
      
      // Simple test query: list tables
      const { data, error } = await customerClient
        .from('information_schema.tables')
        .select('table_name')
        .eq('table_schema', 'public')
        .limit(5)

      if (error) {
        return NextResponse.json({
          success: false,
          error: 'Connection test failed',
          details: error.message,
        })
      }

      const remainingQueries = hasPaidSubscription 
        ? 'unlimited' 
        : MAX_TEST_QUERIES - (credential.test_queries_used || 0) - 1

      return NextResponse.json({
        success: true,
        message: 'Connection successful! ✅',
        sample_data: {
          tables_found: data?.length || 0,
          sample_tables: data?.slice(0, 3).map((t: any) => t.table_name) || [],
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
