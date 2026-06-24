/**
 * MCP Gateway Route — the core product
 *
 * This is the public endpoint that any MCP client (Claude Desktop, Zapier
 * MCP Client, Cursor, Cline, etc.) calls. It implements JSON-RPC 2.0 over
 * the MCP Streamable HTTP transport (spec: 2025-03-26).
 *
 * Content negotiation:
 *   - If the client's Accept header includes `text/event-stream`, responses
 *     are emitted as a single-message SSE stream (required by strict
 *     clients like Zapier MCP v4.0.1 and Bedrock AgentCore).
 *   - Otherwise, responses are emitted as plain `application/json` (the
 *     historic default; Claude Desktop is happy with either).
 *
 * GET on this endpoint opens a server-initiated SSE channel (older spec
 * versions used this for server-pushed messages). Synra is purely
 * request-response, so the stream is kept alive with periodic comments
 * and closed by Vercel's function timeout — clients are unaffected.
 *
 * PUBLIC — no auth required. Authorization is via the unguessable
 * endpointId in the URL.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/encryption'
import { SUPABASE_TOOLS, handleSupabaseTool } from '@/lib/mcp-handlers/supabase'
import { POSTGRESQL_TOOLS, handlePostgresqlTool } from '@/lib/mcp-handlers/postgresql'
import { MYSQL_TOOLS, handleMysqlTool } from '@/lib/mcp-handlers/mysql'
import { MSSQL_TOOLS, handleMssqlTool } from '@/lib/mcp-handlers/mssql'
import type { PostgresqlConfig } from '@/lib/mcp-handlers/postgresql'
import type { MysqlConfig } from '@/lib/mcp-handlers/mysql'
import type { MssqlConfig } from '@/lib/mcp-handlers/mssql'
import { NextRequest, NextResponse } from 'next/server'

// ─── Content negotiation ────────────────────────────────────────────

function clientAcceptsSSE(request: NextRequest): boolean {
  const accept = (request.headers.get('accept') || '').toLowerCase()
  return accept.includes('text/event-stream')
}

// ─── CORS / shared headers ──────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Max-Age': '86400',
}

// ─── Structured logging ─────────────────────────────────────────────

type LogMeta = Record<string, unknown>

function logMcp(stage: string, meta: LogMeta) {
  // Single-line JSON for easy grep / log-aggregator parsing.
  // Vercel captures stdout, so console.log is the right choice here.
  try {
    console.log(`[MCP] ${stage} ${JSON.stringify(meta)}`)
  } catch {
    console.log(`[MCP] ${stage} (unserializable meta)`)
  }
}

function sanitizeHeaders(request: NextRequest): Record<string, string> {
  // Capture headers that are diagnostically useful without leaking auth.
  const interesting = [
    'accept',
    'accept-encoding',
    'content-type',
    'user-agent',
    'origin',
    'referer',
    'mcp-session-id',
    'mcp-protocol-version',
    'last-event-id',
    'x-forwarded-for',
  ]
  const out: Record<string, string> = {}
  for (const key of interesting) {
    const value = request.headers.get(key)
    if (value !== null) out[key] = value
  }
  return out
}

// ─── JSON-RPC response helpers (content-negotiation aware) ──────────

function formatSSE(message: unknown): string {
  // MCP-spec-compliant SSE framing: a single `message` event, then close.
  // Trailing blank line terminates the event per the SSE spec.
  return `event: message\ndata: ${JSON.stringify(message)}\n\n`
}

function rpcResponse(
  request: NextRequest,
  payload: unknown,
  extraHeaders: Record<string, string> = {}
): NextResponse {
  const wantsSSE = clientAcceptsSSE(request)
  const baseHeaders = { ...CORS_HEADERS, ...extraHeaders }

  if (wantsSSE) {
    return new NextResponse(formatSSE(payload), {
      status: 200,
      headers: {
        ...baseHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  }

  return NextResponse.json(payload, {
    status: 200,
    headers: baseHeaders,
  })
}

function jsonRpcSuccess(
  request: NextRequest,
  id: number | string | null,
  result: unknown,
  extraHeaders: Record<string, string> = {}
): NextResponse {
  return rpcResponse(request, { jsonrpc: '2.0', id, result }, extraHeaders)
}

function jsonRpcError(
  request: NextRequest,
  id: number | string | null,
  code: number,
  message: string,
  extraHeaders: Record<string, string> = {}
): NextResponse {
  return rpcResponse(
    request,
    { jsonrpc: '2.0', id, error: { code, message } },
    extraHeaders
  )
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

// ─── OPTIONS (CORS preflight) ───────────────────────────────────────

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

// ─── GET handler ────────────────────────────────────────────────────
//
// Two roles:
//   1. Browser/curl health check → returns JSON status (legacy behavior).
//   2. MCP client opening a server-initiated SSE channel (per the
//      2025-03-26 transport spec). We have no server-initiated messages
//      to push, so we just keep the stream open with periodic comments
//      until the client disconnects or the function times out.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ endpointId: string }> }
) {
  const { endpointId } = await params
  const wantsSSE = clientAcceptsSSE(request)

  logMcp('GET', {
    endpointId,
    wantsSSE,
    headers: sanitizeHeaders(request),
  })

  const endpoint = await lookupEndpoint(endpointId)

  if (!endpoint) {
    return NextResponse.json(
      { error: 'Endpoint not found' },
      { status: 404, headers: CORS_HEADERS }
    )
  }

  if (!endpoint.is_active) {
    return NextResponse.json(
      { error: 'Endpoint is inactive' },
      { status: 403, headers: CORS_HEADERS }
    )
  }

  if (wantsSSE) {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(': mcp-stream-open\n\n'))
        const interval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': keepalive\n\n'))
          } catch {
            clearInterval(interval)
          }
        }, 25_000)
        // Auto-close after ~5 minutes to play nicely with serverless
        // execution limits. Clients reconnect transparently.
        const timeout = setTimeout(() => {
          clearInterval(interval)
          try {
            controller.close()
          } catch {}
        }, 5 * 60 * 1000)
        // Best-effort cleanup if the controller errors out.
        ;(controller as any)._cleanup = () => {
          clearInterval(interval)
          clearTimeout(timeout)
        }
      },
      cancel() {
        // Client disconnected — interval is cleared via the next enqueue throwing.
      },
    })

    return new NextResponse(stream, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  }

  return NextResponse.json(
    {
      name: 'Synra MCP Gateway',
      version: '1.0.0',
      status: 'active',
      service: endpoint.service_slug,
      endpoint: endpointId,
    },
    { headers: CORS_HEADERS }
  )
}

// ─── POST handler (MCP JSON-RPC) ───────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ endpointId: string }> }
) {
  const { endpointId } = await params
  const startTime = Date.now()
  const wantsSSE = clientAcceptsSSE(request)

  let body: any
  try {
    body = await request.json()
  } catch {
    logMcp('POST.parse_error', {
      endpointId,
      headers: sanitizeHeaders(request),
    })
    return jsonRpcError(request, null, -32700, 'Parse error: invalid JSON')
  }

  const { jsonrpc, id, method, params: rpcParams } = body

  // Log every incoming request — this is what lets us diagnose
  // client interop bugs (Zapier, Cursor, AgentCore, etc.).
  logMcp('POST', {
    endpointId,
    method,
    id,
    wantsSSE,
    headers: sanitizeHeaders(request),
    paramsKeys:
      rpcParams && typeof rpcParams === 'object'
        ? Object.keys(rpcParams)
        : undefined,
  })

  // Validate JSON-RPC format
  if (jsonrpc !== '2.0') {
    return jsonRpcError(
      request,
      id,
      -32600,
      'Invalid Request: must use JSON-RPC 2.0'
    )
  }

  // ── Look up endpoint ──────────────────────────────────────────────

  const endpoint = await lookupEndpoint(endpointId)

  if (!endpoint) {
    return jsonRpcError(request, id, -32001, 'Endpoint not found')
  }

  if (!endpoint.is_active) {
    return jsonRpcError(request, id, -32002, 'Endpoint is inactive')
  }

  const credential = endpoint.credentials

  if (!credential || !credential.is_active) {
    return jsonRpcError(request, id, -32001, 'Credential not found or inactive')
  }

  // ── Check usage limits ────────────────────────────────────────────

  const { canMakeRequest } = await import('@/lib/usage-limits')
  const usageCheck = await canMakeRequest(endpoint.organization_id)

  if (!usageCheck.allowed) {
    return jsonRpcError(
      request,
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
      // Echo the client's requested protocolVersion when it's one we
      // support; otherwise fall back to our current default. This keeps
      // older clients (Zapier MCP v4.0.1, Claude Desktop) happy without
      // forcing a single version onto everyone.
      const SUPPORTED_PROTOCOL_VERSIONS = new Set([
        '2024-11-05',
        '2025-03-26',
        '2025-06-18',
      ])
      const requested = rpcParams?.protocolVersion
      const protocolVersion =
        typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.has(requested)
          ? requested
          : '2025-03-26'

      return jsonRpcSuccess(request, id, {
        protocolVersion,
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: 'Synra MCP Gateway',
          version: '1.0.0',
        },
      })
    }

    // ── Notifications (no response needed) ──────────────────────────
    case 'notifications/initialized':
    case 'notifications/cancelled':
    case 'notifications/progress':
    case 'notifications/roots/list_changed': {
      // Per MCP Streamable HTTP spec: input that is solely
      // notifications/responses MUST receive HTTP 202 Accepted, no body.
      return new NextResponse(null, { status: 202, headers: CORS_HEADERS })
    }

    // ── List tools ──────────────────────────────────────────────────
    case 'tools/list': {
      // Select tool definitions based on service.
      // Neon is a first-class service that uses the PostgreSQL handler under the hood.
      let tools =
        endpoint.service_slug === 'postgresql' || endpoint.service_slug === 'neon'
          ? POSTGRESQL_TOOLS
          : endpoint.service_slug === 'mysql'
            ? MYSQL_TOOLS
            : endpoint.service_slug === 'mssql'
              ? MSSQL_TOOLS
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

      logMcp('POST.tools_list', {
        endpointId,
        serviceSlug: endpoint.service_slug,
        toolCount: tools.length,
        toolNames: tools.map((t) => t.name),
        responseFormat: wantsSSE ? 'sse' : 'json',
      })

      return jsonRpcSuccess(request, id, { tools })
    }

    // ── Call a tool ─────────────────────────────────────────────────
    case 'tools/call': {
      const toolName = rpcParams?.name
      const toolArgs = rpcParams?.arguments || {}

      if (!toolName) {
        return jsonRpcError(
          request,
          id,
          -32602,
          'Invalid params: tool name is required'
        )
      }

      // Select tool definitions based on service. Neon -> PostgreSQL handler.
      const availableTools =
        endpoint.service_slug === 'postgresql' || endpoint.service_slug === 'neon'
          ? POSTGRESQL_TOOLS
          : endpoint.service_slug === 'mysql'
            ? MYSQL_TOOLS
            : endpoint.service_slug === 'mssql'
              ? MSSQL_TOOLS
              : SUPABASE_TOOLS

      // Verify tool exists
      const toolExists = availableTools.some((t) => t.name === toolName)
      if (!toolExists) {
        return jsonRpcError(request, id, -32601, `Tool not found: ${toolName}`)
      }

      // Check allowed_tools restriction
      if (
        endpoint.allowed_tools &&
        Array.isArray(endpoint.allowed_tools) &&
        endpoint.allowed_tools.length > 0 &&
        !endpoint.allowed_tools.includes(toolName)
      ) {
        return jsonRpcError(
          request,
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
          request,
          id,
          -32000,
          'Failed to decrypt credentials. They may need to be re-added.'
        )
      }

      // Parse allowed_tables from config (empty array = no restriction)
      let allowedTables: string[] | undefined
      if (decryptedConfig.allowed_tables) {
        try {
          const parsed = JSON.parse(decryptedConfig.allowed_tables)
          if (Array.isArray(parsed) && parsed.length > 0) {
            allowedTables = parsed
          }
        } catch {
          // Ignore malformed allowed_tables — treat as no restriction
        }
      }

      // Route to the correct handler based on service
      let result

      if (endpoint.service_slug === 'postgresql' || endpoint.service_slug === 'neon') {
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
          const serviceLabel = endpoint.service_slug === 'neon' ? 'Neon' : 'PostgreSQL'
          return jsonRpcError(
            request,
            id,
            -32000,
            `Incomplete ${serviceLabel} credentials. Found keys: [${availableKeys}]. Need host, database, user, and password.`
          )
        }

        result = await handlePostgresqlTool(toolName, toolArgs, pgConfig, allowedTables)
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
            request,
            id,
            -32000,
            `Incomplete MySQL credentials. Found keys: [${availableKeys}]. Need host, database, user, and password.`
          )
        }

        result = await handleMysqlTool(toolName, toolArgs, mysqlConfig, allowedTables)
      } else if (endpoint.service_slug === 'mssql') {
        const mssqlConfig: MssqlConfig = {
          host: decryptedConfig.host,
          port: decryptedConfig.port || '1433',
          database: decryptedConfig.database,
          user: decryptedConfig.user,
          password: decryptedConfig.password,
          ssl: decryptedConfig.ssl,
        }

        if (!mssqlConfig.host || !mssqlConfig.database || !mssqlConfig.user || !mssqlConfig.password) {
          const availableKeys = Object.keys(decryptedConfig).join(', ')
          return jsonRpcError(
            request,
            id,
            -32000,
            `Incomplete MS SQL Server credentials. Found keys: [${availableKeys}]. Need host, database, user, and password.`
          )
        }

        result = await handleMssqlTool(toolName, toolArgs, mssqlConfig, allowedTables)
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
            request,
            id,
            -32000,
            `Incomplete credentials. Found keys: [${availableKeys}]. Need a URL and API key.`
          )
        }

        result = await handleSupabaseTool(toolName, toolArgs, supabaseUrl, apiKey, allowedTables)
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
        return jsonRpcSuccess(request, id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: result.error }),
            },
          ],
          isError: true,
        })
      }

      return jsonRpcSuccess(request, id, {
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
      return jsonRpcSuccess(request, id, {})
    }

    // ── Unknown method ──────────────────────────────────────────────
    default: {
      return jsonRpcError(request, id, -32601, `Method not found: ${method}`)
    }
  }
}

// ─── DELETE (not allowed) ───────────────────────────────────────────

export async function DELETE() {
  return NextResponse.json(
    { error: 'Method not allowed' },
    { status: 405, headers: CORS_HEADERS }
  )
}
