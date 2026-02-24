/**
 * MCP Gateway Route — the core product
 *
 * This is the public endpoint that Claude Desktop (or any MCP client) calls.
 * It handles JSON-RPC 2.0 messages per the MCP Streamable HTTP transport spec.
 *
 * PUBLIC — no auth required (Claude Desktop can't login)
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/encryption'
import { SUPABASE_TOOLS, handleSupabaseTool } from '@/lib/mcp-handlers/supabase'
import { POSTGRESQL_TOOLS, handlePostgresqlTool } from '@/lib/mcp-handlers/postgresql'
import { MYSQL_TOOLS, handleMysqlTool } from '@/lib/mcp-handlers/mysql'
import type { PostgresqlConfig } from '@/lib/mcp-handlers/postgresql'
import type { MysqlConfig } from '@/lib/mcp-handlers/mysql'
import { NextRequest, NextResponse } from 'next/server'

// ─── JSON-RPC Helpers ───────────────────────────────────────────────

function jsonRpcSuccess(id: number | string | null, result: any) {
  return NextResponse.json({
    jsonrpc: '2.0',
    id,
    result,
  })
}

function jsonRpcError(
  id: number | string | null,
  code: number,
  message: string
) {
  return NextResponse.json({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  })
}

// ─── Endpoint Lookup ────────────────────────────────────────────────

async function lookupEndpoint(endpointPath: string) {
  const admin = createAdminClient()

  // Find endpoint by URL path
  const { data: endpoint, error } = await admin
    .from('mcp_endpoints')
    .select('*, credentials(*)')
    .eq('endpoint_url', `/api/mcp/${endpointPath}`)
    .single()

  if (error || !endpoint) {
    return null
  }

  return endpoint
}

// ─── Decrypt Credentials ────────────────────────────────────────────

function decryptCredentialConfig(
  config: Record<string, string>
): Record<string, string> {
  const decrypted: Record<string, string> = {}

  for (const [key, value] of Object.entries(config)) {
    try {
      // Try to decrypt — if it fails, value might not be encrypted
      decrypted[key] = decrypt(value)
    } catch {
      // Not encrypted, use as-is
      decrypted[key] = value
    }
  }

  return decrypted
}

// ─── GET handler (health check) ─────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ endpointId: string }> }
) {
  const { endpointId } = await params

  const endpoint = await lookupEndpoint(endpointId)

  if (!endpoint) {
    return NextResponse.json(
      { error: 'Endpoint not found' },
      { status: 404 }
    )
  }

  if (!endpoint.is_active) {
    return NextResponse.json(
      { error: 'Endpoint is inactive' },
      { status: 403 }
    )
  }

  return NextResponse.json({
    name: 'Synra MCP Gateway',
    version: '1.0.0',
    status: 'active',
    service: endpoint.service_slug,
    endpoint: endpointId,
  })
}

// ─── POST handler (MCP JSON-RPC) ───────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ endpointId: string }> }
) {
  const { endpointId } = await params
  const startTime = Date.now()

  let body: any
  try {
    body = await request.json()
  } catch {
    return jsonRpcError(null, -32700, 'Parse error: invalid JSON')
  }

  const { jsonrpc, id, method, params: rpcParams } = body

  // Validate JSON-RPC format
  if (jsonrpc !== '2.0') {
    return jsonRpcError(id, -32600, 'Invalid Request: must use JSON-RPC 2.0')
  }

  // ── Look up endpoint ──────────────────────────────────────────────

  const endpoint = await lookupEndpoint(endpointId)

  if (!endpoint) {
    return jsonRpcError(id, -32001, 'Endpoint not found')
  }

  if (!endpoint.is_active) {
    return jsonRpcError(id, -32002, 'Endpoint is inactive')
  }

  const credential = endpoint.credentials

  if (!credential || !credential.is_active) {
    return jsonRpcError(id, -32001, 'Credential not found or inactive')
  }

  // ── Check usage limits ────────────────────────────────────────────

  const { canMakeRequest } = await import('@/lib/usage-limits')
  const usageCheck = await canMakeRequest(endpoint.organization_id)

  if (!usageCheck.allowed) {
    return jsonRpcError(
      id,
      -32003,
      usageCheck.reason || 'Rate limit exceeded. Please upgrade your plan.'
    )
  }

  // ── Update last_accessed_at ───────────────────────────────────────

  const admin = createAdminClient()
  admin
    .from('mcp_endpoints')
    .update({ last_accessed_at: new Date().toISOString() })
    .eq('id', endpoint.id)
    .then(() => {}) // fire and forget

  // ── Handle JSON-RPC methods ───────────────────────────────────────

  switch (method) {
    // ── Initialize ──────────────────────────────────────────────────
    case 'initialize': {
      return jsonRpcSuccess(id, {
        protocolVersion: '2025-03-26',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'Synra MCP Gateway',
          version: '1.0.0',
        },
      })
    }

    // ── Notifications (no response needed) ──────────────────────────
    case 'notifications/initialized': {
      // Client confirms initialization — acknowledge with empty response
      return new NextResponse(null, { status: 204 })
    }

    // ── List tools ──────────────────────────────────────────────────
    case 'tools/list': {
      // Select tool definitions based on service
      let tools =
        endpoint.service_slug === 'postgresql'
          ? POSTGRESQL_TOOLS
          : endpoint.service_slug === 'mysql'
            ? MYSQL_TOOLS
            : SUPABASE_TOOLS

      // Filter by allowed_tools if set on the endpoint
      if (
        endpoint.allowed_tools &&
        Array.isArray(endpoint.allowed_tools) &&
        endpoint.allowed_tools.length > 0
      ) {
        tools = tools.filter((t) =>
          endpoint.allowed_tools.includes(t.name)
        )
      }

      return jsonRpcSuccess(id, { tools })
    }

    // ── Call a tool ─────────────────────────────────────────────────
    case 'tools/call': {
      const toolName = rpcParams?.name
      const toolArgs = rpcParams?.arguments || {}

      if (!toolName) {
        return jsonRpcError(id, -32602, 'Invalid params: tool name is required')
      }

      // Select tool definitions based on service
      const availableTools =
        endpoint.service_slug === 'postgresql'
          ? POSTGRESQL_TOOLS
          : endpoint.service_slug === 'mysql'
            ? MYSQL_TOOLS
            : SUPABASE_TOOLS

      // Verify tool exists
      const toolExists = availableTools.some((t) => t.name === toolName)
      if (!toolExists) {
        return jsonRpcError(id, -32601, `Tool not found: ${toolName}`)
      }

      // Check allowed_tools restriction
      if (
        endpoint.allowed_tools &&
        Array.isArray(endpoint.allowed_tools) &&
        endpoint.allowed_tools.length > 0 &&
        !endpoint.allowed_tools.includes(toolName)
      ) {
        return jsonRpcError(
          id,
          -32601,
          `Tool '${toolName}' is not enabled for this endpoint`
        )
      }

      // Decrypt credentials
      let decryptedConfig: Record<string, string>
      try {
        decryptedConfig = decryptCredentialConfig(credential.config)
      } catch (err: any) {
        return jsonRpcError(
          id,
          -32000,
          'Failed to decrypt credentials. They may need to be re-added.'
        )
      }

      // Route to the correct handler based on service
      let result

      if (endpoint.service_slug === 'postgresql') {
        // PostgreSQL: extract connection params
        const pgConfig: PostgresqlConfig = {
          host: decryptedConfig.host,
          port: decryptedConfig.port || '5432',
          database: decryptedConfig.database,
          user: decryptedConfig.user,
          password: decryptedConfig.password,
          ssl: decryptedConfig.ssl,
        }

        if (!pgConfig.host || !pgConfig.database || !pgConfig.user || !pgConfig.password) {
          const availableKeys = Object.keys(decryptedConfig).join(', ')
          return jsonRpcError(
            id,
            -32000,
            `Incomplete PostgreSQL credentials. Found keys: [${availableKeys}]. Need host, database, user, and password.`
          )
        }

        result = await handlePostgresqlTool(toolName, toolArgs, pgConfig)
      } else if (endpoint.service_slug === 'mysql') {
        const mysqlConfig: MysqlConfig = {
          host: decryptedConfig.host,
          port: decryptedConfig.port || '3306',
          database: decryptedConfig.database,
          user: decryptedConfig.user,
          password: decryptedConfig.password,
          ssl: decryptedConfig.ssl,
        }

        if (!mysqlConfig.host || !mysqlConfig.database || !mysqlConfig.user || !mysqlConfig.password) {
          const availableKeys = Object.keys(decryptedConfig).join(', ')
          return jsonRpcError(
            id,
            -32000,
            `Incomplete MySQL credentials. Found keys: [${availableKeys}]. Need host, database, user, and password.`
          )
        }

        result = await handleMysqlTool(toolName, toolArgs, mysqlConfig)
      } else {
        // Supabase (default)
        const supabaseUrl = decryptedConfig.url || decryptedConfig.supabase_url || decryptedConfig.project_url
        const apiKey =
          decryptedConfig.service_role_key ||
          decryptedConfig.api_key ||
          decryptedConfig.anon_key ||
          decryptedConfig.key

        if (!supabaseUrl || !apiKey) {
          const availableKeys = Object.keys(decryptedConfig).join(', ')
          return jsonRpcError(
            id,
            -32000,
            `Incomplete credentials. Found keys: [${availableKeys}]. Need a URL and API key.`
          )
        }

        result = await handleSupabaseTool(toolName, toolArgs, supabaseUrl, apiKey)
      }

      const durationMs = Date.now() - startTime

      // Log usage (fire and forget)
      admin
        .from('usage_logs')
        .insert({
          organization_id: endpoint.organization_id,
          credential_id: credential.id,
          service_slug: endpoint.service_slug,
          tool_name: toolName,
          request_data: { arguments: toolArgs },
          response_status: result.success ? 'success' : 'error',
          error_message: result.error || null,
          duration_ms: durationMs,
        })
        .then(() => {}) // fire and forget

      if (!result.success) {
        return jsonRpcSuccess(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: result.error }),
            },
          ],
          isError: true,
        })
      }

      return jsonRpcSuccess(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result.data, null, 2),
          },
        ],
      })
    }

    // ── Ping ────────────────────────────────────────────────────────
    case 'ping': {
      return jsonRpcSuccess(id, {})
    }

    // ── Unknown method ──────────────────────────────────────────────
    default: {
      return jsonRpcError(id, -32601, `Method not found: ${method}`)
    }
  }
}

// ─── DELETE (not allowed) ───────────────────────────────────────────

export async function DELETE() {
  return NextResponse.json(
    { error: 'Method not allowed' },
    { status: 405 }
  )
}
