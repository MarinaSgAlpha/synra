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
import { MIXPANEL_TOOLS, handleMixpanelTool } from '@/lib/mcp-handlers/mixpanel'
import { STRIPE_TOOLS, handleStripeTool } from '@/lib/mcp-handlers/stripe'
import { NextRequest, NextResponse } from 'next/server'

// ─── Service Registry ───────────────────────────────────────────────

type ToolDef = { name: string; description: string; inputSchema: any }
type ToolResult = { success: boolean; data?: any; error?: string }

interface ServiceHandler {
  tools: ToolDef[]
  handle: (
    toolName: string,
    args: Record<string, any>,
    config: Record<string, string>
  ) => Promise<ToolResult>
}

const SERVICE_HANDLERS: Record<string, ServiceHandler> = {
  supabase: {
    tools: SUPABASE_TOOLS,
    handle: async (toolName, args, config) => {
      const url = config.url || config.supabase_url || config.project_url
      const key = config.service_role_key || config.api_key || config.anon_key || config.key
      if (!url || !key) {
        return { success: false, error: `Incomplete credentials. Need a URL and API key.` }
      }
      return handleSupabaseTool(toolName, args, url, key)
    },
  },
  mixpanel: {
    tools: MIXPANEL_TOOLS,
    handle: async (toolName, args, config) => {
      const projectId = config.project_id
      const username = config.service_account_username
      const secret = config.service_account_secret
      if (!projectId || !username || !secret) {
        return { success: false, error: 'Incomplete credentials. Need project_id, service_account_username, and service_account_secret.' }
      }
      return handleMixpanelTool(toolName, args, { project_id: projectId, service_account_username: username, service_account_secret: secret })
    },
  },
  stripe: {
    tools: STRIPE_TOOLS,
    handle: async (toolName, args, config) => {
      const secretKey = config.secret_key || config.api_key
      if (!secretKey) {
        return { success: false, error: 'Incomplete credentials. Need a Stripe secret key.' }
      }
      return handleStripeTool(toolName, args, secretKey)
    },
  },
}

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
      // Get the handler for this service
      const serviceHandler = SERVICE_HANDLERS[endpoint.service_slug]
      if (!serviceHandler) {
        return jsonRpcError(id, -32000, `Unsupported service: ${endpoint.service_slug}`)
      }

      let tools = serviceHandler.tools

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

      // Get the handler for this service
      const handler = SERVICE_HANDLERS[endpoint.service_slug]
      if (!handler) {
        return jsonRpcError(id, -32000, `Unsupported service: ${endpoint.service_slug}`)
      }

      // Verify tool exists for this service
      const toolExists = handler.tools.some((t) => t.name === toolName)
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

      // Execute the tool via the service handler
      const result = await handler.handle(toolName, toolArgs, decryptedConfig)

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
