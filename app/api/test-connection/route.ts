import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/encryption'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const MAX_TEST_QUERIES = 10

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
      
      // Simple test: Make a REST API request to verify credentials work
      // We'll hit the REST API root to check if the URL and key are valid
      const testResponse = await fetch(`${supabaseUrl}/rest/v1/`, {
        method: 'HEAD',
        headers: {
          'apikey': apiKey,
          'Authorization': `Bearer ${apiKey}`,
        },
      })

      const remainingQueries = hasPaidSubscription 
        ? 'unlimited' 
        : MAX_TEST_QUERIES - (credential.test_queries_used || 0) - 1

      // If we get any response (even 404), credentials are valid
      if (!testResponse.ok && testResponse.status === 401) {
        return NextResponse.json({
          success: false,
          error: 'Invalid API key or unauthorized',
          details: 'Check your Supabase URL and API key',
        })
      }

      // Connection works! Now generate a helpful insight
      const insight = 'Your Supabase connection is live and ready! Subscribe to run unlimited AI-powered queries across your entire database schema.'

      return NextResponse.json({
        success: true,
        message: 'Connection successful!',
        sample_data: {
          connection_verified: true,
          supabase_url: new URL(supabaseUrl).hostname,
          insight,
        },
        remaining_test_queries: remainingQueries,
      })
    } catch (err: any) {
      return NextResponse.json({
        success: false,
        error: 'Connection test failed',
        details: err.message || 'Unable to reach Supabase URL',
      })
    }
  } catch (error: any) {
    console.error('Test connection error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
