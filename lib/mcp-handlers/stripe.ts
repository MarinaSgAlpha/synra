/**
 * Stripe MCP Handler
 *
 * Connects to a customer's Stripe account using their API key
 * and executes read-only operations on payments, customers, etc.
 */

// ─── Tool Definitions (MCP schema) ──────────────────────────────────

export const STRIPE_TOOLS = [
  {
    name: 'list_customers',
    description:
      'List customers from Stripe. Supports pagination and filtering by email.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        email: {
          type: 'string',
          description: 'Filter by customer email address',
        },
        limit: {
          type: 'number',
          description: 'Number of customers to return (max 100)',
          default: 25,
        },
        starting_after: {
          type: 'string',
          description: 'Cursor for pagination (customer ID)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_customer',
    description: 'Get detailed information about a specific customer.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        customer_id: {
          type: 'string',
          description: 'Stripe customer ID (e.g. cus_xxxxx)',
        },
      },
      required: ['customer_id'],
    },
  },
  {
    name: 'list_charges',
    description:
      'List charges/payments. Filter by customer, date range, or status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        customer: {
          type: 'string',
          description: 'Filter by customer ID',
        },
        limit: {
          type: 'number',
          description: 'Number of charges to return (max 100)',
          default: 25,
        },
        starting_after: {
          type: 'string',
          description: 'Cursor for pagination (charge ID)',
        },
        created_gte: {
          type: 'number',
          description: 'Filter charges created after this Unix timestamp',
        },
        created_lte: {
          type: 'number',
          description: 'Filter charges created before this Unix timestamp',
        },
      },
      required: [],
    },
  },
  {
    name: 'list_subscriptions',
    description:
      'List active subscriptions. Filter by customer or status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        customer: {
          type: 'string',
          description: 'Filter by customer ID',
        },
        status: {
          type: 'string',
          enum: [
            'active',
            'past_due',
            'canceled',
            'unpaid',
            'trialing',
            'all',
          ],
          description: 'Filter by subscription status',
          default: 'active',
        },
        limit: {
          type: 'number',
          description: 'Number of subscriptions to return (max 100)',
          default: 25,
        },
        starting_after: {
          type: 'string',
          description: 'Cursor for pagination (subscription ID)',
        },
      },
      required: [],
    },
  },
  {
    name: 'list_invoices',
    description:
      'List invoices. Filter by customer or status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        customer: {
          type: 'string',
          description: 'Filter by customer ID',
        },
        status: {
          type: 'string',
          enum: ['draft', 'open', 'paid', 'uncollectible', 'void'],
          description: 'Filter by invoice status',
        },
        limit: {
          type: 'number',
          description: 'Number of invoices to return (max 100)',
          default: 25,
        },
        starting_after: {
          type: 'string',
          description: 'Cursor for pagination (invoice ID)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_balance',
    description:
      'Get the current Stripe account balance (available and pending).',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_products',
    description: 'List products in your Stripe catalog.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        active: {
          type: 'boolean',
          description: 'Filter by active/inactive products',
        },
        limit: {
          type: 'number',
          description: 'Number of products to return (max 100)',
          default: 25,
        },
      },
      required: [],
    },
  },
  {
    name: 'get_revenue_summary',
    description:
      'Get a revenue summary: total charges, refunds, and net revenue over a date range.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        created_gte: {
          type: 'number',
          description: 'Start of date range as Unix timestamp',
        },
        created_lte: {
          type: 'number',
          description: 'End of date range as Unix timestamp',
        },
      },
      required: [],
    },
  },
]

// ─── API Helpers ────────────────────────────────────────────────────

const STRIPE_API_BASE = 'https://api.stripe.com/v1'

async function stripeRequest(
  path: string,
  secretKey: string,
  params: Record<string, string> = {}
): Promise<any> {
  const searchParams = new URLSearchParams(params)
  const url = `${STRIPE_API_BASE}${path}?${searchParams.toString()}`

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(
      `Stripe API error: ${error.error?.message || response.statusText}`
    )
  }

  return response.json()
}

// ─── Tool Implementations ───────────────────────────────────────────

async function listCustomers(
  secretKey: string,
  args: Record<string, any>
): Promise<any> {
  const params: Record<string, string> = {
    limit: String(Math.min(args.limit || 25, 100)),
  }
  if (args.email) params.email = args.email
  if (args.starting_after) params.starting_after = args.starting_after

  return stripeRequest('/customers', secretKey, params)
}

async function getCustomer(
  secretKey: string,
  args: Record<string, any>
): Promise<any> {
  return stripeRequest(`/customers/${args.customer_id}`, secretKey)
}

async function listCharges(
  secretKey: string,
  args: Record<string, any>
): Promise<any> {
  const params: Record<string, string> = {
    limit: String(Math.min(args.limit || 25, 100)),
  }
  if (args.customer) params.customer = args.customer
  if (args.starting_after) params.starting_after = args.starting_after
  if (args.created_gte) params['created[gte]'] = String(args.created_gte)
  if (args.created_lte) params['created[lte]'] = String(args.created_lte)

  return stripeRequest('/charges', secretKey, params)
}

async function listSubscriptions(
  secretKey: string,
  args: Record<string, any>
): Promise<any> {
  const params: Record<string, string> = {
    limit: String(Math.min(args.limit || 25, 100)),
  }
  if (args.customer) params.customer = args.customer
  if (args.status && args.status !== 'all') params.status = args.status
  if (args.starting_after) params.starting_after = args.starting_after

  return stripeRequest('/subscriptions', secretKey, params)
}

async function listInvoices(
  secretKey: string,
  args: Record<string, any>
): Promise<any> {
  const params: Record<string, string> = {
    limit: String(Math.min(args.limit || 25, 100)),
  }
  if (args.customer) params.customer = args.customer
  if (args.status) params.status = args.status
  if (args.starting_after) params.starting_after = args.starting_after

  return stripeRequest('/invoices', secretKey, params)
}

async function getBalance(secretKey: string): Promise<any> {
  return stripeRequest('/balance', secretKey)
}

async function listProducts(
  secretKey: string,
  args: Record<string, any>
): Promise<any> {
  const params: Record<string, string> = {
    limit: String(Math.min(args.limit || 25, 100)),
  }
  if (args.active !== undefined) params.active = String(args.active)

  return stripeRequest('/products', secretKey, params)
}

async function getRevenueSummary(
  secretKey: string,
  args: Record<string, any>
): Promise<any> {
  // Get charges
  const chargeParams: Record<string, string> = { limit: '100' }
  if (args.created_gte) chargeParams['created[gte]'] = String(args.created_gte)
  if (args.created_lte) chargeParams['created[lte]'] = String(args.created_lte)

  const charges = await stripeRequest('/charges', secretKey, chargeParams)

  // Calculate summary
  let totalCharges = 0
  let totalRefunded = 0
  let successfulCount = 0
  let failedCount = 0

  for (const charge of charges.data || []) {
    if (charge.status === 'succeeded') {
      totalCharges += charge.amount
      totalRefunded += charge.amount_refunded || 0
      successfulCount++
    } else if (charge.status === 'failed') {
      failedCount++
    }
  }

  return {
    period: {
      from: args.created_gte
        ? new Date(args.created_gte * 1000).toISOString()
        : 'all time',
      to: args.created_lte
        ? new Date(args.created_lte * 1000).toISOString()
        : 'now',
    },
    total_charges_cents: totalCharges,
    total_charges_formatted: `$${(totalCharges / 100).toFixed(2)}`,
    total_refunded_cents: totalRefunded,
    total_refunded_formatted: `$${(totalRefunded / 100).toFixed(2)}`,
    net_revenue_cents: totalCharges - totalRefunded,
    net_revenue_formatted: `$${((totalCharges - totalRefunded) / 100).toFixed(2)}`,
    successful_charges: successfulCount,
    failed_charges: failedCount,
    charges_in_response: charges.data?.length || 0,
    has_more: charges.has_more,
  }
}

// ─── Main Handler ───────────────────────────────────────────────────

export interface ToolCallResult {
  success: boolean
  data?: any
  error?: string
}

export async function handleStripeTool(
  toolName: string,
  args: Record<string, any>,
  secretKey: string
): Promise<ToolCallResult> {
  try {
    switch (toolName) {
      case 'list_customers': {
        const data = await listCustomers(secretKey, args)
        return { success: true, data }
      }

      case 'get_customer': {
        if (!args.customer_id) {
          return { success: false, error: 'customer_id is required' }
        }
        const data = await getCustomer(secretKey, args)
        return { success: true, data }
      }

      case 'list_charges': {
        const data = await listCharges(secretKey, args)
        return { success: true, data }
      }

      case 'list_subscriptions': {
        const data = await listSubscriptions(secretKey, args)
        return { success: true, data }
      }

      case 'list_invoices': {
        const data = await listInvoices(secretKey, args)
        return { success: true, data }
      }

      case 'get_balance': {
        const data = await getBalance(secretKey)
        return { success: true, data }
      }

      case 'list_products': {
        const data = await listProducts(secretKey, args)
        return { success: true, data }
      }

      case 'get_revenue_summary': {
        const data = await getRevenueSummary(secretKey, args)
        return { success: true, data }
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` }
    }
  } catch (err: any) {
    return { success: false, error: err.message || 'Tool execution failed' }
  }
}
