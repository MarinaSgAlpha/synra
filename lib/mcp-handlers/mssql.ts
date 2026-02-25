/**
 * MS SQL Server MCP Handler
 *
 * Connects to a CUSTOMER's SQL Server database using their decrypted credentials
 * and executes read-only database operations.
 *
 * Supports Azure SQL, AWS RDS SQL Server, self-hosted SQL Server, etc.
 */

import sql from 'mssql'
import { sanitizeSql, sanitizeTableName } from '@/lib/sql-sanitizer'
import type { ToolCallResult } from '@/lib/mcp-handlers/supabase'

const MAX_ROWS = 500

// ─── Tool Definitions (MCP schema) ──────────────────────────────────

export const MSSQL_TOOLS = [
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

// ─── MS SQL Config Type ─────────────────────────────────────────────

export interface MssqlConfig {
  host: string
  port: string
  database: string
  user: string
  password: string
  ssl?: boolean | string
}

// ─── Connection Config ─────────────────────────────────────────────

function createMssqlConfig(config: MssqlConfig): sql.config {
  const useEncrypt =
    config.ssl === true ||
    config.ssl === 'true' ||
    config.ssl === '1' ||
    config.ssl === 'on'

  return {
    server: config.host,
    port: parseInt(config.port, 10) || 1433,
    database: config.database,
    user: config.user,
    password: config.password,
    options: {
      encrypt: useEncrypt,
      trustServerCertificate: useEncrypt, // Allow self-signed certs common in cloud
      connectTimeout: 10000,
      requestTimeout: 30000,
    },
  }
}

// ─── Tool Implementations ────────────────────────────────────────────

async function listTables(pool: sql.ConnectionPool): Promise<string[]> {
  const result = await pool.request().query(`
    SELECT TABLE_SCHEMA, TABLE_NAME 
    FROM INFORMATION_SCHEMA.TABLES 
    WHERE TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_SCHEMA, TABLE_NAME
  `)
  return (result.recordset as any[]).map(
    (r) => (r.TABLE_SCHEMA !== 'dbo' ? `${r.TABLE_SCHEMA}.${r.TABLE_NAME}` : r.TABLE_NAME)
  )
}

async function describeTable(
  pool: sql.ConnectionPool,
  tableName: string
): Promise<any[]> {
  const safeName = sanitizeTableName(tableName)
  const parts = safeName.includes('.') ? safeName.split('.').map((p) => p.trim()) : [safeName]
  const schema = parts.length > 1 ? parts[0] : 'dbo'
  const table = parts.length > 1 ? parts[1] : parts[0]

  const request = pool.request()
  request.input('schema', sql.VarChar(128), schema)
  request.input('table', sql.VarChar(128), table)

  const result = await request.query(`
    SELECT 
      COLUMN_NAME as column_name,
      DATA_TYPE as data_type,
      IS_NULLABLE as is_nullable,
      COLUMN_DEFAULT as column_default,
      CHARACTER_MAXIMUM_LENGTH as character_maximum_length
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
    ORDER BY ORDINAL_POSITION
  `)

  const rows = result.recordset as any[]
  if (rows.length === 0) {
    throw new Error(`Table '${safeName}' not found or has no columns`)
  }
  return rows
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
  pool: sql.ConnectionPool,
  params: QueryParams
): Promise<any[]> {
  const safeName = sanitizeTableName(params.table_name)
  const limit = Math.min(params.limit || 50, MAX_ROWS)
  const offset = params.offset || 0

  // SQL Server uses square brackets for identifiers; support schema.table
  const parts = safeName.includes('.') ? safeName.split('.').map((p) => p.trim()) : [safeName]
  const bracketName =
    parts.length > 1
      ? parts.map((p) => `[${p}]`).join('.')
      : `[dbo].[${safeName}]`

  const selectCols =
    params.select && params.select !== '*'
      ? params.select
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean)
          .map((c) => {
            sanitizeTableName(c)
            return `[${c}]`
          })
          .join(', ')
      : '*'

  const whereClauses: string[] = []
  const request = pool.request()

  if (params.filters && typeof params.filters === 'object') {
    let i = 0
    for (const [column, value] of Object.entries(params.filters)) {
      sanitizeTableName(column)
      const paramName = `p${i}`
      if (value === null) {
        whereClauses.push(`[${column}] IS NULL`)
      } else {
        whereClauses.push(`[${column}] = @${paramName}`)
        request.input(paramName, value)
        i++
      }
    }
  }

  const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

  let orderStr = 'ORDER BY (SELECT NULL)' // Required for OFFSET/FETCH
  if (params.order_by) {
    sanitizeTableName(params.order_by)
    const dir = params.order_direction === 'desc' ? 'DESC' : 'ASC'
    orderStr = `ORDER BY [${params.order_by}] ${dir}`
  }

  const sqlStr = `SELECT ${selectCols} FROM ${bracketName} ${whereStr} ${orderStr} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`

  const result = await request.query(sqlStr)
  return result.recordset as any[]
}

async function executeSql(pool: sql.ConnectionPool, sqlStr: string): Promise<any> {
  const check = sanitizeSql(sqlStr)
  if (!check.safe) {
    throw new Error(`SQL rejected: ${check.reason}`)
  }
  const result = await pool.request().query(sqlStr)
  return result.recordset
}

// ─── Main Handler ───────────────────────────────────────────────────

export async function handleMssqlTool(
  toolName: string,
  args: Record<string, any>,
  config: MssqlConfig
): Promise<ToolCallResult> {
  const pool = await sql.connect(createMssqlConfig(config))

  try {
    switch (toolName) {
      case 'list_tables': {
        const tables = await listTables(pool)
        return { success: true, data: { tables } }
      }

      case 'describe_table': {
        if (!args.table_name) {
          return { success: false, error: 'table_name is required' }
        }
        const columns = await describeTable(pool, args.table_name)
        return { success: true, data: { table: args.table_name, columns } }
      }

      case 'query_table': {
        if (!args.table_name) {
          return { success: false, error: 'table_name is required' }
        }
        const rows = await queryTable(pool, args as QueryParams)
        return {
          success: true,
          data: { table: args.table_name, row_count: rows.length, rows },
        }
      }

      case 'execute_sql': {
        if (!args.sql) {
          return { success: false, error: 'sql is required' }
        }
        const result = await executeSql(pool, args.sql)
        return { success: true, data: result }
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` }
    }
  } catch (err: any) {
    return { success: false, error: err.message || 'Tool execution failed' }
  } finally {
    try {
      await pool.close()
    } catch {
      // Ignore close errors
    }
  }
}
