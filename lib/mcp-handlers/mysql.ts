/**
 * MySQL MCP Handler
 *
 * Connects to a CUSTOMER's MySQL database using their decrypted credentials
 * and executes read-only database operations.
 *
 * Supports any MySQL host: PlanetScale, AWS RDS, Railway, self-hosted, etc.
 */

import mysql from 'mysql2/promise'
import { sanitizeSql, sanitizeTableName } from '@/lib/sql-sanitizer'
import type { ToolCallResult } from '@/lib/mcp-handlers/supabase'

const MAX_ROWS = 500

// ─── Tool Definitions (MCP schema) ──────────────────────────────────

export const MYSQL_TOOLS = [
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

// ─── MySQL Config Type ───────────────────────────────────────────────

export interface MysqlConfig {
  host: string
  port: string
  database: string
  user: string
  password: string
  ssl?: boolean | string
}

// ─── Client Creation ──────────────────────────────────────────────────

function createMysqlConnection(config: MysqlConfig): mysql.ConnectionOptions {
  const useSsl =
    config.ssl === true ||
    config.ssl === 'true' ||
    config.ssl === '1' ||
    config.ssl === 'on'

  return {
    host: config.host,
    port: parseInt(config.port, 10) || 3306,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: useSsl ? {} : undefined,
    connectTimeout: 10000,
  }
}

// ─── Tool Implementations ────────────────────────────────────────────

async function listTables(conn: mysql.Connection, database: string): Promise<string[]> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME 
     FROM INFORMATION_SCHEMA.TABLES 
     WHERE TABLE_SCHEMA = ? 
     AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
    [database]
  )
  return rows.map((r) => r.TABLE_NAME)
}

async function describeTable(
  conn: mysql.Connection,
  database: string,
  tableName: string
): Promise<any[]> {
  const safeName = sanitizeTableName(tableName)

  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    `SELECT 
       COLUMN_NAME as column_name,
       DATA_TYPE as data_type,
       IS_NULLABLE as is_nullable,
       COLUMN_DEFAULT as column_default,
       CHARACTER_MAXIMUM_LENGTH as character_maximum_length
     FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_SCHEMA = ? 
     AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [database, safeName]
  )

  if (rows.length === 0) {
    throw new Error(
      `Table '${safeName}' not found or has no columns`
    )
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
  conn: mysql.Connection,
  database: string,
  params: QueryParams
): Promise<any[]> {
  const safeName = sanitizeTableName(params.table_name)
  const limit = Math.min(params.limit || 50, MAX_ROWS)
  const offset = params.offset || 0

  // MySQL uses backticks for identifiers
  const selectCols = params.select && params.select !== '*'
    ? params.select
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
        .map((c) => {
          sanitizeTableName(c)
          return `\`${c}\``
        })
        .join(', ')
    : '*'

  const whereClauses: string[] = []
  const queryValues: any[] = []

  if (params.filters && typeof params.filters === 'object') {
    for (const [column, value] of Object.entries(params.filters)) {
      sanitizeTableName(column)
      if (value === null) {
        whereClauses.push(`\`${column}\` IS NULL`)
      } else {
        whereClauses.push(`\`${column}\` = ?`)
        queryValues.push(value)
      }
    }
  }

  const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

  let orderStr = ''
  if (params.order_by) {
    sanitizeTableName(params.order_by)
    const dir = params.order_direction === 'desc' ? 'DESC' : 'ASC'
    orderStr = `ORDER BY \`${params.order_by}\` ${dir}`
  }

  const sql = `SELECT ${selectCols} FROM \`${safeName}\` ${whereStr} ${orderStr} LIMIT ? OFFSET ?`
  queryValues.push(limit, offset)

  const [rows] = await conn.execute<mysql.RowDataPacket[]>(sql, queryValues)
  return rows
}

async function executeSql(conn: mysql.Connection, sql: string): Promise<any> {
  const check = sanitizeSql(sql)
  if (!check.safe) {
    throw new Error(`SQL rejected: ${check.reason}`)
  }

  const [rows] = await conn.execute(sql)
  return rows
}

// ─── Main Handler ────────────────────────────────────────────────────

export async function handleMysqlTool(
  toolName: string,
  args: Record<string, any>,
  config: MysqlConfig
): Promise<ToolCallResult> {
  const conn = await mysql.createConnection(createMysqlConnection(config))

  try {
    const database = config.database

    switch (toolName) {
      case 'list_tables': {
        const tables = await listTables(conn, database)
        return { success: true, data: { tables } }
      }

      case 'describe_table': {
        if (!args.table_name) {
          return { success: false, error: 'table_name is required' }
        }
        const columns = await describeTable(conn, database, args.table_name)
        return { success: true, data: { table: args.table_name, columns } }
      }

      case 'query_table': {
        if (!args.table_name) {
          return { success: false, error: 'table_name is required' }
        }
        const rows = await queryTable(conn, database, args as QueryParams)
        return {
          success: true,
          data: { table: args.table_name, row_count: rows.length, rows },
        }
      }

      case 'execute_sql': {
        if (!args.sql) {
          return { success: false, error: 'sql is required' }
        }
        const result = await executeSql(conn, args.sql)
        return { success: true, data: result }
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` }
    }
  } catch (err: any) {
    return { success: false, error: err.message || 'Tool execution failed' }
  } finally {
    try {
      await conn.end()
    } catch {
      // Ignore close errors
    }
  }
}
