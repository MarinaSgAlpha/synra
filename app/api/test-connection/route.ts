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
      
      // Get actual table information using PostgreSQL system tables
      // This works because we can use the REST API to query pg_catalog
      const { data: tables, error: tableError } = await customerClient
        .rpc('exec_sql', {
          query: `
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
            ORDER BY table_name
            LIMIT 10
          `
        })
      
      // If RPC doesn't exist, use simpler approach
      if (tableError) {
        // Try any simple query to verify connection
        // Most Supabase projects have these system tables accessible
        const testQueries = [
          customerClient.from('pg_tables').select('tablename').eq('schemaname', 'public').limit(5),
          customerClient.schema('public').rpc('version'), // PostgreSQL version
        ]

        let connectionWorks = false
        let tableCount = 0
        let sampleTables: string[] = []

        // Try the first query
        const { data: pgTables, error: pgError } = await testQueries[0]
        
        if (!pgError && pgTables) {
          connectionWorks = true
          tableCount = pgTables.length
          sampleTables = pgTables.slice(0, 3).map((t: any) => t.tablename)
        } else if (pgError && (
          pgError.message.includes('does not exist') ||
          pgError.code === 'PGRST116' ||
          pgError.message.includes('permission denied')
        )) {
          // These errors mean connection works, just no access/no tables
          connectionWorks = true
        }

        const remainingQueries = hasPaidSubscription 
          ? 'unlimited' 
          : MAX_TEST_QUERIES - (credential.test_queries_used || 0) - 1

        if (!connectionWorks) {
          return NextResponse.json({
            success: false,
            error: 'Unable to connect to database',
            details: pgError?.message || 'Invalid credentials or connection refused',
          })
        }

        // Generate insight
        let insight = ''
        if (tableCount === 0) {
          insight = 'Connection verified! Your database is ready. Subscribe to run AI queries and explore your schema.'
        } else if (tableCount < 5) {
          insight = `Found ${tableCount} table${tableCount === 1 ? '' : 's'}. Your database is connected and ready for AI-powered queries.`
        } else {
          insight = `Detected ${tableCount}+ tables (${sampleTables.slice(0, 2).join(', ')}...). Subscribe to unlock unlimited AI queries.`
        }

        return NextResponse.json({
          success: true,
          message: 'Connection successful!',
          sample_data: {
            table_count: tableCount > 0 ? tableCount : undefined,
            sample_tables: sampleTables.length > 0 ? sampleTables : undefined,
            insight,
          },
          remaining_test_queries: remainingQueries,
        })
      }

      // Success - we got real table data!
      const tableList = Array.isArray(tables) ? tables : []
      const tableCount = tableList.length
      const sampleTables = tableList.slice(0, 3).map((t: any) => t.table_name)

      const remainingQueries = hasPaidSubscription 
        ? 'unlimited' 
        : MAX_TEST_QUERIES - (credential.test_queries_used || 0) - 1

      // Generate insight based on table count
      let insight = ''
      if (tableCount === 0) {
        insight = 'Your database is empty. You can start creating tables and querying them through Claude!'
      } else if (tableCount < 5) {
        insight = `Found ${tableCount} table${tableCount === 1 ? '' : 's'}. Your database is set up and ready for AI queries.`
      } else if (tableCount < 10) {
        insight = `Detected ${tableCount} tables including ${sampleTables.slice(0, 2).join(', ')}. Good schema size for AI exploration.`
      } else {
        insight = `Found ${tableCount}+ tables (showing ${sampleTables.join(', ')}...). Substantial database ready for AI-powered queries.`
      }

      return NextResponse.json({
        success: true,
        message: 'Connection successful!',
        sample_data: {
          table_count: tableCount,
          sample_tables: sampleTables,
          insight,
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
