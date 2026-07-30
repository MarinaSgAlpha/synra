/**
 * PostgreSQL MCP Handler
 *
 * Connects to a CUSTOMER's PostgreSQL database using their decrypted credentials
 * and executes read-only database operations.
 *
 * Supports any PostgreSQL host: AWS RDS, Neon, Railway, Render, DigitalOcean, self-hosted, etc.
 */

import { Client } from 'pg'
import { sanitizeSql, sanitizeTableName, withSqlHint, capSqlResult } from '@/lib/sql-sanitizer'
import type { ToolCallResult } from '@/lib/mcp-handlers/supabase'

const MAX_ROWS = 500

// ─── Tool Definitions (MCP schema) ──────────────────────────────────

export const POSTGRESQL_TOOLS = [
  {
    name: 'list_tables',
    description: 'List all tables in the database',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'describe_table',
    description: 'Get the schema/columns of a specific table',
    inputSchema: {
      type: 'object' as const,
      properties: {
        table_name: {
          type: 'string',
          description:
            'Name of the table to describe. Use schema.table for tables outside the public schema.',
        },
      },
      required: ['table_name'],
    },
  },
  {
    name: 'query_table',
    description:
      'Query data from a table with optional filters. Read-only SELECT queries only.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        table_name: {
          type: 'string',
          description:
            'Name of the table to query. Use schema.table for tables outside the public schema.',
        },
        select: {
          type: 'string',
          description:
            'Comma-separated column names to select. Use * for all columns.',
          default: '*',
        },
        filters: {
          type: 'object',
          description:
            'Key-value pairs for WHERE clause filtering (column: value)',
          additionalProperties: true,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of rows to return (max 500)',
          default: 50,
        },
        offset: {
          type: 'number',
          description: 'Number of rows to skip',
          default: 0,
        },
        order_by: {
          type: 'string',
          description: 'Column name to order by',
        },
        order_direction: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort direction',
          default: 'asc',
        },
      },
      required: ['table_name'],
    },
  },
  {
    name: 'execute_sql',
    description:
      'Execute a read-only SQL query. Only SELECT statements are allowed. No INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE, GRANT, or REVOKE.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sql: {
          type: 'string',
          description: 'SQL query to execute. Must be a SELECT statement.',
        },
      },
      required: ['sql'],
    },
  },
]

// ─── PostgreSQL Config Type ─────────────────────────────────────────

export interface PostgresqlConfig {
  host: string
  port: string
  database: string
  user: string
  password: string
  ssl?: boolean | string
}

// ─── Client Creation ────────────────────────────────────────────────

function createPgClient(config: PostgresqlConfig): Client {
  const useSsl =
    config.ssl === true ||
    config.ssl === 'true' ||
    config.ssl === '1' ||
    config.ssl === 'on'

  return new Client({
    host: config.host,
    port: parseInt(config.port, 10) || 5432,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 10000,
    // 120s: analytical joins routinely exceed the old 30s cap (see
    // customer timeout errors in usage_logs). Must stay below the
    // route's maxDuration so the DB, not the platform, kills the query.
    statement_timeout: 120000,
  })
}

// ─── Tool Implementations ───────────────────────────────────────────

async function listTables(client: Client): Promise<string[]> {
  const result = await client.query(
    `SELECT table_schema, table_name 
     FROM information_schema.tables 
     WHERE table_schema NOT IN ('pg_catalog', 'information_schema') 
     AND table_type = 'BASE TABLE'
     ORDER BY table_schema, table_name`
  )
  // Same convention as the MSSQL handler: tables outside the default
  // schema are returned as schema.table so they round-trip through
  // describe_table / query_table.
  return result.rows.map((r) =>
    r.table_schema !== 'public' ? `${r.table_schema}.${r.table_name}` : r.table_name
  )
}

/** Split an already-sanitized name into [schema, table], defaulting to public. */
function splitSchemaTable(safeName: string): [string, string] {
  const parts = safeName.split('.').filter(Boolean)
  return parts.length > 1 ? [parts[0], parts[1]] : ['public', parts[0]]
}

async function describeTable(
  client: Client,
  tableName: string
): Promise<any[]> {
  const safeName = sanitizeTableName(tableName)
  const [schema, table] = splitSchemaTable(safeName)

  const result = await client.query(
    `SELECT 
       column_name,
       data_type,
       is_nullable,
       column_default,
       character_maximum_length
     FROM information_schema.columns 
     WHERE table_schema = $1 
     AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, table]
  )

  if (result.rows.length === 0) {
    throw new Error(
      `Table '${safeName}' not found or has no columns. Call list_tables to see available tables (tables outside the public schema are listed as schema.table).`
    )
  }

  return result.rows
}

interface QueryParams {
  table_name: string
  select?: string
  filters?: Record<string, any>
  limit?: number
  offset?: number
  order_by?: string
  order_direction?: 'asc' | 'desc'
}

async function queryTable(
  client: Client,
  params: QueryParams
): Promise<any[]> {
  const safeName = sanitizeTableName(params.table_name)
  const [schema, table] = splitSchemaTable(safeName)
  const quotedName = `"${schema}"."${table}"`
  const limit = Math.min(params.limit || 50, MAX_ROWS)
  const offset = params.offset || 0

  // Build SELECT columns
  const selectCols = params.select && params.select !== '*'
    ? params.select
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
        .map((c) => {
          // Validate each column name
          sanitizeTableName(c)
          return `"${c}"`
        })
        .join(', ')
    : '*'

  // Build WHERE clause with parameterized values
  const whereClauses: string[] = []
  const queryValues: any[] = []
  let paramIndex = 1

  if (params.filters && typeof params.filters === 'object') {
    for (const [column, value] of Object.entries(params.filters)) {
      sanitizeTableName(column) // validate column name
      if (value === null) {
        whereClauses.push(`"${column}" IS NULL`)
      } else {
        whereClauses.push(`"${column}" = $${paramIndex}`)
        queryValues.push(value)
        paramIndex++
      }
    }
  }

  const whereStr =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

  // Build ORDER BY
  let orderStr = ''
  if (params.order_by) {
    sanitizeTableName(params.order_by) // validate column name
    const dir = params.order_direction === 'desc' ? 'DESC' : 'ASC'
    orderStr = `ORDER BY "${params.order_by}" ${dir}`
  }

  const sql = `SELECT ${selectCols} FROM ${quotedName} ${whereStr} ${orderStr} LIMIT ${limit} OFFSET ${offset}`

  const result = await client.query(sql, queryValues)
  return result.rows
}

async function executeSql(client: Client, sql: string): Promise<any> {
  // Sanitize first — blocks destructive queries
  const check = sanitizeSql(sql)
  if (!check.safe) {
    throw new Error(`SQL rejected: ${check.reason}`)
  }

  const result = await client.query(sql)
  return capSqlResult(result.rows, MAX_ROWS)
}

// ─── Main Handler (dispatches tool calls) ───────────────────────────

export async function handlePostgresqlTool(
  toolName: string,
  args: Record<string, any>,
  config: PostgresqlConfig,
  allowedTables?: string[]
): Promise<ToolCallResult> {
  const client = createPgClient(config)

  const isTableAllowed = (tableName: string) =>
    !allowedTables || allowedTables.includes(tableName)

  try {
    await client.connect()

    switch (toolName) {
      case 'list_tables': {
        let tables = await listTables(client)
        if (allowedTables) {
          tables = tables.filter((t) => allowedTables.includes(t))
        }
        return { success: true, data: { tables } }
      }

      case 'describe_table': {
        if (!args.table_name) {
          return { success: false, error: 'table_name is required' }
        }
        if (!isTableAllowed(args.table_name)) {
          return { success: false, error: `Access denied: table '${args.table_name}' is not in the allowed list` }
        }
        const columns = await describeTable(client, args.table_name)
        return { success: true, data: { table: args.table_name, columns } }
      }

      case 'query_table': {
        if (!args.table_name) {
          return { success: false, error: 'table_name is required' }
        }
        if (!isTableAllowed(args.table_name)) {
          return { success: false, error: `Access denied: table '${args.table_name}' is not in the allowed list` }
        }
        const rows = await queryTable(client, args as QueryParams)
        return {
          success: true,
          data: { table: args.table_name, row_count: rows.length, rows },
        }
      }

      case 'execute_sql': {
        if (!args.sql) {
          return { success: false, error: 'sql is required' }
        }
        try {
          const result = await executeSql(client, args.sql)
          return { success: true, data: result }
        } catch (err: any) {
          return { success: false, error: withSqlHint(err.message) }
        }
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` }
    }
  } catch (err: any) {
    return { success: false, error: err.message || 'Tool execution failed' }
  } finally {
    try {
      await client.end()
    } catch {
      // Ignore close errors
    }
  }
}
