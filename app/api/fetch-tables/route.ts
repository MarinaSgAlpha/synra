import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/encryption'
import { NextRequest, NextResponse } from 'next/server'
import { Client as PgClient } from 'pg'
import mysql from 'mysql2/promise'
import sql from 'mssql'

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

    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', authUser.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'No organization found' }, { status: 404 })
    }

    const { data: credential } = await admin
      .from('credentials')
      .select('*')
      .eq('id', credentialId)
      .eq('organization_id', membership.organization_id)
      .single()

    if (!credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

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

    const serviceSlug = credential.service_slug
    let tables: string[] = []

    // Neon speaks the Postgres wire protocol — route it through the same path.
    if (serviceSlug === 'postgresql' || serviceSlug === 'neon') {
      const pgClient = new PgClient({
        host: decryptedConfig.host,
        port: parseInt(decryptedConfig.port || '5432', 10),
        database: decryptedConfig.database,
        user: decryptedConfig.user,
        password: decryptedConfig.password,
        ssl: (decryptedConfig.ssl === 'true' || decryptedConfig.ssl === '1')
          ? { rejectUnauthorized: false }
          : undefined,
        connectionTimeoutMillis: 10000,
        statement_timeout: 15000,
      })

      try {
        await pgClient.connect()
        const result = await pgClient.query(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
           ORDER BY table_name`
        )
        tables = result.rows.map((r: any) => r.table_name)
      } finally {
        try { await pgClient.end() } catch {}
      }
    } else if (serviceSlug === 'mysql') {
      const conn = await mysql.createConnection({
        host: decryptedConfig.host,
        port: parseInt(decryptedConfig.port || '3306', 10),
        database: decryptedConfig.database,
        user: decryptedConfig.user,
        password: decryptedConfig.password,
        ssl: (decryptedConfig.ssl === 'true' || decryptedConfig.ssl === '1') ? {} : undefined,
        connectTimeout: 10000,
      })

      try {
        const [rows] = await conn.execute<mysql.RowDataPacket[]>(
          `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
           WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
           ORDER BY TABLE_NAME`,
          [decryptedConfig.database]
        )
        tables = rows.map((r) => r.TABLE_NAME)
      } finally {
        try { await conn.end() } catch {}
      }
    } else if (serviceSlug === 'mssql') {
      const useEncrypt = decryptedConfig.ssl === 'true' || decryptedConfig.ssl === '1'
      const pool = await sql.connect({
        server: decryptedConfig.host,
        port: parseInt(decryptedConfig.port || '1433', 10),
        database: decryptedConfig.database,
        user: decryptedConfig.user,
        password: decryptedConfig.password,
        options: {
          encrypt: useEncrypt,
          trustServerCertificate: useEncrypt,
          connectTimeout: 10000,
          requestTimeout: 15000,
        },
      })

      try {
        const result = await pool.request().query(`
          SELECT TABLE_SCHEMA, TABLE_NAME
          FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_TYPE = 'BASE TABLE'
          ORDER BY TABLE_SCHEMA, TABLE_NAME
        `)
        tables = (result.recordset as any[]).map(
          (r) => (r.TABLE_SCHEMA !== 'dbo' ? `${r.TABLE_SCHEMA}.${r.TABLE_NAME}` : r.TABLE_NAME)
        )
      } finally {
        try { await pool.close() } catch {}
      }
    } else if (serviceSlug === 'supabase') {
      // Supabase exposes its schema via PostgREST's OpenAPI spec at /rest/v1/.
      // Each key under `definitions` is a table name (plus a few internal helpers
      // we filter out). This avoids requiring a custom RPC function in the
      // customer's database.
      const supabaseUrl =
        decryptedConfig.url ||
        decryptedConfig.supabase_url ||
        decryptedConfig.project_url
      const apiKey =
        decryptedConfig.service_role_key ||
        decryptedConfig.api_key ||
        decryptedConfig.anon_key ||
        decryptedConfig.key

      if (!supabaseUrl || !apiKey) {
        return NextResponse.json({ error: 'Incomplete Supabase credentials' }, { status: 400 })
      }

      const specRes = await fetch(`${supabaseUrl}/rest/v1/`, {
        headers: {
          apikey: apiKey,
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/openapi+json',
        },
      })

      if (!specRes.ok) {
        return NextResponse.json(
          { error: `Failed to fetch Supabase schema (HTTP ${specRes.status})` },
          { status: 502 }
        )
      }

      const spec = await specRes.json()
      tables = Object.keys(spec.definitions || {})
        .filter((name) => !name.startsWith('rpc/'))
        .sort()
    } else {
      return NextResponse.json({ error: 'Table access is not supported for this service type' }, { status: 400 })
    }

    return NextResponse.json({ tables })
  } catch (error: any) {
    console.error('Fetch tables error:', error)
    return NextResponse.json({ error: error.message || 'Failed to fetch tables' }, { status: 500 })
  }
}
