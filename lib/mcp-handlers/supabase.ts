/**
 * Supabase MCP Handler
 *
 * Connects to a CUSTOMER's Supabase instance using their decrypted credentials
 * and executes read-only database operations.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { sanitizeSql, sanitizeTableName } from '@/lib/sql-sanitizer'

const MAX_ROWS = 500

// ─── Tool Definitions (MCP schema) ──────────────────────────────────

export const SUPABASE_TOOLS = [
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
          description: 'Name of the table to describe',
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
          description: 'Name of the table to query',
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

// ─── Customer Supabase Client ───────────────────────────────────────

function createCustomerClient(
  supabaseUrl: string,
  apiKey: string
): SupabaseClient {
  return createClient(supabaseUrl, apiKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

// ─── Tool Implementations ───────────────────────────────────────────

interface ColumnInfo {
  column_name: string
  data_type: string
  is_nullable: string
  column_default: string | null
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

/**
 * List all tables in the customer's public schema
 */
async function listTables(
  supabaseUrl: string,
  apiKey: string
): Promise<string[]> {
  const client = createCustomerClient(supabaseUrl, apiKey)

  // Use PostgREST RPC if available, otherwise fall back to information_schema query
  const { data, error } = await client.rpc('get_public_tables').select()

  if (error) {
    // Fallback: query information_schema directly via the REST API
    const response = await fetch(
      `${supabaseUrl}/rest/v1/rpc/get_public_tables`,
      {
        method: 'POST',
        headers: {
          apikey: apiKey,
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      }
    )

    if (!response.ok) {
      // Final fallback: use a direct query through the REST API
      // Query the information_schema through a raw select
      const tablesRes = await fetch(
        `${supabaseUrl}/rest/v1/?apikey=${apiKey}`,
        {
          headers: {
            apikey: apiKey,
            Authorization: `Bearer ${apiKey}`,
          },
        }
      )

      if (tablesRes.ok) {
        // The root endpoint returns OpenAPI spec with table definitions
        const spec = await tablesRes.json()
        if (spec.definitions) {
          return Object.keys(spec.definitions).filter(
            (name) => !name.startsWith('rpc/')
          )
        }
      }

      throw new Error(
        `Failed to list tables: ${error?.message || 'Unknown error'}`
      )
    }

    const fallbackData = await response.json()
    return Array.isArray(fallbackData)
      ? fallbackData.map((r: any) => r.table_name || r)
      : []
  }

  return Array.isArray(data)
    ? data.map((r: any) => r.table_name || r)
    : []
}

/**
 * Describe the columns of a specific table
 */
async function describeTable(
  supabaseUrl: string,
  apiKey: string,
  tableName: string
): Promise<ColumnInfo[]> {
  const safeName = sanitizeTableName(tableName)

  // Try using the OpenAPI spec to get column info
  const response = await fetch(`${supabaseUrl}/rest/v1/`, {
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
  })

  if (response.ok) {
    const spec = await response.json()
    const tableDef = spec.definitions?.[safeName]

    if (tableDef && tableDef.properties) {
      return Object.entries(tableDef.properties).map(
        ([colName, colDef]: [string, any]) => ({
          column_name: colName,
          data_type: colDef.format || colDef.type || 'unknown',
          is_nullable: tableDef.required?.includes(colName) ? 'NO' : 'YES',
          column_default: colDef.default ?? null,
        })
      )
    }
  }

  throw new Error(
    `Could not describe table '${safeName}'. Table may not exist or is not accessible.`
  )
}

/**
 * Query data from a table using the Supabase client
 */
async function queryTable(
  supabaseUrl: string,
  apiKey: string,
  params: QueryParams
): Promise<any[]> {
  const client = createCustomerClient(supabaseUrl, apiKey)
  const safeName = sanitizeTableName(params.table_name)

  // Enforce max limit
  const limit = Math.min(params.limit || 50, MAX_ROWS)
  const offset = params.offset || 0

  let query = client.from(safeName).select(params.select || '*')

  // Apply filters
  if (params.filters) {
    for (const [column, value] of Object.entries(params.filters)) {
      if (value === null) {
        query = query.is(column, null)
      } else if (typeof value === 'string' && value.startsWith('%')) {
        query = query.ilike(column, value)
      } else {
        query = query.eq(column, value)
      }
    }
  }

  // Apply ordering
  if (params.order_by) {
    query = query.order(params.order_by, {
      ascending: params.order_direction !== 'desc',
    })
  }

  // Apply pagination
  query = query.range(offset, offset + limit - 1)

  const { data, error } = await query

  if (error) {
    throw new Error(`Query failed: ${error.message}`)
  }

  return data || []
}

/**
 * Execute a raw read-only SQL query
 * Uses Supabase's pg_net or rpc approach
 */
async function executeSql(
  supabaseUrl: string,
  apiKey: string,
  sql: string
): Promise<any> {
  // Sanitize first
  const check = sanitizeSql(sql)
  if (!check.safe) {
    throw new Error(`SQL rejected: ${check.reason}`)
  }

  // Use the Supabase REST API with a raw query via pg
  // The cleanest approach: use the /rest/v1/rpc endpoint if a function exists
  // Otherwise use the /pg endpoint (available with service role key)
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/execute_readonly_query`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ query_text: sql }),
  })

  if (response.ok) {
    return await response.json()
  }

  // If the RPC function doesn't exist, return a helpful message
  if (response.status === 404) {
    return {
      error: 'execute_sql requires a helper function in your Supabase database. Use query_table for most queries, or create the execute_readonly_query function. See Synra docs for setup instructions.',
      hint: 'Try using the query_table tool instead — it works without any setup.',
    }
  }

  const errorText = await response.text()
  throw new Error(`SQL execution failed: ${errorText}`)
}

// ─── Main Handler (dispatches tool calls) ───────────────────────────

export interface ToolCallResult {
  success: boolean
  data?: any
  error?: string
}

export async function handleSupabaseTool(
  toolName: string,
  args: Record<string, any>,
  supabaseUrl: string,
  apiKey: string
): Promise<ToolCallResult> {
  try {
    switch (toolName) {
      case 'list_tables': {
        const tables = await listTables(supabaseUrl, apiKey)
        return { success: true, data: { tables } }
      }

      case 'describe_table': {
        if (!args.table_name) {
          return { success: false, error: 'table_name is required' }
        }
        const columns = await describeTable(supabaseUrl, apiKey, args.table_name)
        return { success: true, data: { table: args.table_name, columns } }
      }

      case 'query_table': {
        if (!args.table_name) {
          return { success: false, error: 'table_name is required' }
        }
        const rows = await queryTable(supabaseUrl, apiKey, args as QueryParams)
        return {
          success: true,
          data: { table: args.table_name, row_count: rows.length, rows },
        }
      }

      case 'execute_sql': {
        if (!args.sql) {
          return { success: false, error: 'sql is required' }
        }
        const result = await executeSql(supabaseUrl, apiKey, args.sql)
        return { success: true, data: result }
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` }
    }
  } catch (err: any) {
    return { success: false, error: err.message || 'Tool execution failed' }
  }
}
