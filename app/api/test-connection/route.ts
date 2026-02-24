import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/encryption'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Client as PgClient } from 'pg'
import mysql from 'mysql2/promise'

const MAX_TEST_QUERIES = 10

function generateClaudeMessage(tables: string[], tableCount: number): string {
  if (tableCount === 0) {
    return "Hi! I'm Claude 👋 Your database is connected, but it looks empty right now. Once you create some tables, I'll be able to query them and help you build amazing things. To connect in Claude Desktop: Settings -> Connectors -> Add custom connector -> paste your MCP endpoint URL."
  } else if (tableCount === 1) {
    return `Hey there! 👋 I'm Claude, and I can see your database has 1 table: "${tables[0]}". I'm ready to query your data and run analytics. To connect in Claude Desktop: Settings -> Connectors -> Add custom connector -> paste your MCP endpoint URL.`
  } else if (tableCount <= 5) {
    const tableList = tables.slice(0, 3).join(', ')
    return `Hi! I'm Claude 👋 I can see ${tableCount} tables in your database (${tableList}${tableCount > 3 ? ', ...' : ''}). I'm ready to fetch data, run queries, and analyze everything. To connect in Claude Desktop: Settings -> Connectors -> Add custom connector -> paste your MCP endpoint URL.`
  } else {
    const sampleTables = tables.slice(0, 3).join(', ')
    return `Hello! I'm Claude 👋 Your database looks great - I can see ${tableCount} tables including ${sampleTables}, and more. I'm ready to query across your entire schema, join data, and analyze patterns. To connect in Claude Desktop: Settings -> Connectors -> Add custom connector -> paste your MCP endpoint URL.`
  }
}

// POST — Execute a test query to show value (max 10 free queries)
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

    const remainingQueries = hasPaidSubscription 
      ? 'unlimited' 
      : MAX_TEST_QUERIES - (credential.test_queries_used || 0) - 1

    // Get service_slug to determine which test to run
    const serviceSlug = credential.service_slug

    // ── PostgreSQL test connection ─────────────────────────────────
    if (serviceSlug === 'postgresql') {
      const host = decryptedConfig.host
      const port = decryptedConfig.port || '5432'
      const database = decryptedConfig.database
      const user = decryptedConfig.user
      const password = decryptedConfig.password
      const useSsl = decryptedConfig.ssl === 'true' || decryptedConfig.ssl === '1'

      if (!host || !database || !user || !password) {
        return NextResponse.json({ error: 'Incomplete PostgreSQL credentials' }, { status: 400 })
      }

      const pgClient = new PgClient({
        host,
        port: parseInt(port, 10) || 5432,
        database,
        user,
        password,
        ssl: useSsl ? { rejectUnauthorized: false } : undefined,
        connectionTimeoutMillis: 10000,
        statement_timeout: 15000,
      })

      try {
        await pgClient.connect()

        const result = await pgClient.query(
          `SELECT table_name 
           FROM information_schema.tables 
           WHERE table_schema = 'public' 
           AND table_type = 'BASE TABLE'
           ORDER BY table_name`
        )

        const tables = result.rows.map((r: any) => r.table_name)
        const tableCount = tables.length

        const claudeMessage = generateClaudeMessage(tables, tableCount)

        return NextResponse.json({
          success: true,
          message: 'Connection successful!',
          sample_data: {
            table_count: tableCount,
            sample_tables: tables.slice(0, 5),
            claude_says: claudeMessage,
          },
          remaining_test_queries: remainingQueries,
        })
      } catch (err: any) {
        return NextResponse.json({
          success: false,
          error: 'PostgreSQL connection failed',
          details: err.message || 'Unable to connect to database',
        })
      } finally {
        try {
          await pgClient.end()
        } catch {
          // Ignore close errors
        }
      }
    }

    // ── MySQL test connection ─────────────────────────────────────
    if (serviceSlug === 'mysql') {
      const host = decryptedConfig.host
      const port = decryptedConfig.port || '3306'
      const database = decryptedConfig.database
      const user = decryptedConfig.user
      const password = decryptedConfig.password
      const useSsl = decryptedConfig.ssl === 'true' || decryptedConfig.ssl === '1'

      if (!host || !database || !user || !password) {
        return NextResponse.json({ error: 'Incomplete MySQL credentials' }, { status: 400 })
      }

      let conn: mysql.Connection | null = null

      try {
        conn = await mysql.createConnection({
          host,
          port: parseInt(port, 10) || 3306,
          database,
          user,
          password,
          ssl: useSsl ? {} : undefined,
          connectTimeout: 10000,
        })

        const [rows] = await conn.execute(
          `SELECT TABLE_NAME 
           FROM INFORMATION_SCHEMA.TABLES 
           WHERE TABLE_SCHEMA = ? 
           AND TABLE_TYPE = 'BASE TABLE'
           ORDER BY TABLE_NAME`,
          [database]
        )

        const tables = (rows as mysql.RowDataPacket[]).map((r) => r.TABLE_NAME)
        const tableCount = tables.length

        const claudeMessage = generateClaudeMessage(tables, tableCount)

        return NextResponse.json({
          success: true,
          message: 'Connection successful!',
          sample_data: {
            table_count: tableCount,
            sample_tables: tables.slice(0, 5),
            claude_says: claudeMessage,
          },
          remaining_test_queries: remainingQueries,
        })
      } catch (err: any) {
        return NextResponse.json({
          success: false,
          error: 'MySQL connection failed',
          details: err.message || 'Unable to connect to database',
        })
      } finally {
        if (conn) {
          try {
            await conn.end()
          } catch {
            // Ignore close errors
          }
        }
      }
    }

    // ── Supabase test connection (default) ─────────────────────────

    // Get Supabase URL and key
    const supabaseUrl = decryptedConfig.url || decryptedConfig.supabase_url || decryptedConfig.project_url
    const apiKey = decryptedConfig.service_role_key || decryptedConfig.api_key || decryptedConfig.anon_key || decryptedConfig.key

    if (!supabaseUrl || !apiKey) {
      return NextResponse.json({ error: 'Incomplete credentials' }, { status: 400 })
    }

    // Create Supabase client and test connection
    try {
      // Get the OpenAPI schema from PostgREST - this lists all available tables
      const schemaResponse = await fetch(`${supabaseUrl}/rest/v1/`, {
        method: 'GET',
        headers: {
          'apikey': apiKey,
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/openapi+json',
        },
      })

      // Check for auth errors
      if (!schemaResponse.ok && schemaResponse.status === 401) {
        return NextResponse.json({
          success: false,
          error: 'Invalid API key or unauthorized',
          details: 'Check your Supabase URL and API key',
        })
      }

      // Parse the OpenAPI schema to get table names
      let tables: string[] = []
      let tableCount = 0
      
      try {
        const schema = await schemaResponse.json()
        // OpenAPI schema has paths like "/table_name" for each table
        if (schema.paths) {
          tables = Object.keys(schema.paths)
            .filter(path => path.startsWith('/') && !path.includes('{'))
            .map(path => path.substring(1)) // remove leading slash
            .filter(name => !name.startsWith('rpc/')) // exclude RPC functions
            .sort()
          tableCount = tables.length
        }
      } catch (e) {
        // If we can't parse schema, that's OK - connection still works
      }

      const claudeMessage = generateClaudeMessage(tables, tableCount)

      return NextResponse.json({
        success: true,
        message: 'Connection successful!',
        sample_data: {
          table_count: tableCount,
          sample_tables: tables.slice(0, 5),
          claude_says: claudeMessage,
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
