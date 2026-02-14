/**
 * Reddit Conversions API (CAPI) Integration
 * Sends server-side conversion events to Reddit for better attribution
 */

interface RedditConversionEvent {
  event_at: string // ISO 8601 timestamp
  event_type: {
    tracking_type: 'Purchase' | 'AddToCart' | 'Lead' | 'SignUp' | 'Custom'
    custom_event_name?: string
  }
  user: {
    email?: string
    external_id?: string
    ip_address?: string
    user_agent?: string
  }
  event_metadata?: {
    conversion_id?: string
    currency?: string
    value?: number
    item_count?: number
    products?: Array<{
      id: string
      name: string
      category?: string
    }>
  }
}

interface RedditCAPIPayload {
  events: RedditConversionEvent[]
  test_mode?: boolean
}

/**
 * Send conversion event to Reddit CAPI
 */
export async function sendRedditConversion(params: {
  eventType: 'Purchase' | 'Lead' | 'SignUp' | 'AddToCart'
  conversionId: string
  email?: string
  externalId?: string
  value?: number
  currency?: string
  ipAddress?: string
  userAgent?: string
  testMode?: boolean
}): Promise<{ success: boolean; error?: string }> {
  const accessToken = process.env.REDDIT_CAPI_ACCESS_TOKEN

  if (!accessToken) {
    console.warn('⚠️ REDDIT_CAPI_ACCESS_TOKEN not set, skipping CAPI event')
    return { success: false, error: 'Missing access token' }
  }

  try {
    const event: RedditConversionEvent = {
      event_at: new Date().toISOString(),
      event_type: {
        tracking_type: params.eventType,
      },
      user: {
        email: params.email,
        external_id: params.externalId,
        ip_address: params.ipAddress,
        user_agent: params.userAgent,
      },
      event_metadata: {
        conversion_id: params.conversionId,
        currency: params.currency || 'USD',
        value: params.value,
      },
    }

    const payload: RedditCAPIPayload = {
      events: [event],
      test_mode: params.testMode || false,
    }

    const response = await fetch('https://ads-api.reddit.com/api/v2.0/conversions/events/a2_ie6pid7z8xzv', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('❌ Reddit CAPI error:', response.status, errorText)
      return { success: false, error: `HTTP ${response.status}: ${errorText}` }
    }

    const result = await response.json()
    console.log('✅ Reddit CAPI event sent:', params.eventType, params.conversionId)
    return { success: true }
  } catch (error: any) {
    console.error('❌ Reddit CAPI exception:', error)
    return { success: false, error: error.message }
  }
}
