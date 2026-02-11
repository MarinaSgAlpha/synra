/**
 * Mixpanel MCP Handler
 *
 * Connects to a customer's Mixpanel project using their credentials
 * and executes read-only analytics operations.
 */

// ─── Tool Definitions (MCP schema) ──────────────────────────────────

export const MIXPANEL_TOOLS = [
  {
    name: 'query_events',
    description:
      'Query event data from Mixpanel. Returns events matching the specified criteria within a date range.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        event: {
          type: 'string',
          description: 'Event name to query (e.g. "Sign Up", "Purchase")',
        },
        from_date: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format',
        },
        to_date: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of events to return (max 1000)',
          default: 100,
        },
      },
      required: ['from_date', 'to_date'],
    },
  },
  {
    name: 'get_top_events',
    description:
      'Get the most common events in the project, ranked by volume.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Number of top events to return (max 100)',
          default: 10,
        },
      },
      required: [],
    },
  },
  {
    name: 'get_event_count',
    description:
      'Get the total count of a specific event (or all events) over a date range, segmented by day.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        event: {
          type: 'string',
          description:
            'Event name to count. Omit to count all events.',
        },
        from_date: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format',
        },
        to_date: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format',
        },
        unit: {
          type: 'string',
          enum: ['hour', 'day', 'week', 'month'],
          description: 'Time unit for aggregation',
          default: 'day',
        },
      },
      required: ['from_date', 'to_date'],
    },
  },
  {
    name: 'get_funnel',
    description:
      'Get funnel conversion data. Define a sequence of events to see drop-off between steps.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        funnel_id: {
          type: 'number',
          description: 'The Mixpanel funnel ID to query',
        },
        from_date: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format',
        },
        to_date: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format',
        },
      },
      required: ['funnel_id', 'from_date', 'to_date'],
    },
  },
  {
    name: 'get_user_profiles',
    description:
      'Query user profiles from Mixpanel People. Supports filtering by properties.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        where: {
          type: 'string',
          description:
            'Filter expression (e.g. \'properties["plan"] == "pro"\')',
        },
        limit: {
          type: 'number',
          description: 'Maximum profiles to return (max 1000)',
          default: 25,
        },
      },
      required: [],
    },
  },
]

// ─── API Helpers ────────────────────────────────────────────────────

const MIXPANEL_API_BASE = 'https://mixpanel.com/api'
const MIXPANEL_DATA_API = 'https://data.mixpanel.com/api'

interface MixpanelConfig {
  project_id: string
  service_account_username: string
  service_account_secret: string
}

function getAuthHeader(config: MixpanelConfig): string {
  const credentials = Buffer.from(
    `${config.service_account_username}:${config.service_account_secret}`
  ).toString('base64')
  return `Basic ${credentials}`
}

async function mixpanelRequest(
  url: string,
  config: MixpanelConfig,
  params: Record<string, string> = {}
): Promise<any> {
  const searchParams = new URLSearchParams({
    project_id: config.project_id,
    ...params,
  })

  const response = await fetch(`${url}?${searchParams.toString()}`, {
    headers: {
      Authorization: getAuthHeader(config),
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Mixpanel API error (${response.status}): ${text}`)
  }

  return response.json()
}

// ─── Tool Implementations ───────────────────────────────────────────

async function queryEvents(
  config: MixpanelConfig,
  args: Record<string, any>
): Promise<any> {
  const params: Record<string, string> = {
    from_date: args.from_date,
    to_date: args.to_date,
    limit: String(Math.min(args.limit || 100, 1000)),
  }

  if (args.event) {
    params.event = JSON.stringify([args.event])
  }

  return mixpanelRequest(
    `${MIXPANEL_DATA_API}/2.0/export`,
    config,
    params
  )
}

async function getTopEvents(
  config: MixpanelConfig,
  args: Record<string, any>
): Promise<any> {
  const limit = Math.min(args.limit || 10, 100)

  return mixpanelRequest(
    `${MIXPANEL_API_BASE}/2.0/events/names`,
    config,
    { limit: String(limit) }
  )
}

async function getEventCount(
  config: MixpanelConfig,
  args: Record<string, any>
): Promise<any> {
  const params: Record<string, string> = {
    from_date: args.from_date,
    to_date: args.to_date,
    unit: args.unit || 'day',
  }

  if (args.event) {
    params.event = JSON.stringify([args.event])
  }

  return mixpanelRequest(
    `${MIXPANEL_API_BASE}/2.0/events`,
    config,
    params
  )
}

async function getFunnel(
  config: MixpanelConfig,
  args: Record<string, any>
): Promise<any> {
  return mixpanelRequest(
    `${MIXPANEL_API_BASE}/2.0/funnels`,
    config,
    {
      funnel_id: String(args.funnel_id),
      from_date: args.from_date,
      to_date: args.to_date,
    }
  )
}

async function getUserProfiles(
  config: MixpanelConfig,
  args: Record<string, any>
): Promise<any> {
  const params: Record<string, string> = {
    page_size: String(Math.min(args.limit || 25, 1000)),
  }

  if (args.where) {
    params.filter_by_cohort = args.where
  }

  return mixpanelRequest(
    `${MIXPANEL_API_BASE}/2.0/engage`,
    config,
    params
  )
}

// ─── Main Handler ───────────────────────────────────────────────────

export interface ToolCallResult {
  success: boolean
  data?: any
  error?: string
}

export async function handleMixpanelTool(
  toolName: string,
  args: Record<string, any>,
  config: MixpanelConfig
): Promise<ToolCallResult> {
  try {
    switch (toolName) {
      case 'query_events': {
        if (!args.from_date || !args.to_date) {
          return { success: false, error: 'from_date and to_date are required' }
        }
        const data = await queryEvents(config, args)
        return { success: true, data }
      }

      case 'get_top_events': {
        const data = await getTopEvents(config, args)
        return { success: true, data }
      }

      case 'get_event_count': {
        if (!args.from_date || !args.to_date) {
          return { success: false, error: 'from_date and to_date are required' }
        }
        const data = await getEventCount(config, args)
        return { success: true, data }
      }

      case 'get_funnel': {
        if (!args.funnel_id || !args.from_date || !args.to_date) {
          return {
            success: false,
            error: 'funnel_id, from_date, and to_date are required',
          }
        }
        const data = await getFunnel(config, args)
        return { success: true, data }
      }

      case 'get_user_profiles': {
        const data = await getUserProfiles(config, args)
        return { success: true, data }
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` }
    }
  } catch (err: any) {
    return { success: false, error: err.message || 'Tool execution failed' }
  }
}
