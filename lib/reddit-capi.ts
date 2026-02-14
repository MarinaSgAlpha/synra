/**
 * Reddit Conversions API (CAPI) Integration
 * Sends server-side conversion events to Reddit for better attribution
 */

interface RedditConversionEvent {
  event_at: number // Unix epoch timestamp in milliseconds
  type: {
    tracking_type: 'Purchase' | 'AddToCart' | 'Lead' | 'SignUp' | 'Custom'
    custom_event_name?: string
  }
  click_id?: string
  user?: {
    email?: string
    external_id?: string
    ip_address?: string
    user_agent?: string
    phone_number?: string
    screen_dimensions?: {
      width: number
      height: number
    }
  }
  metadata?: {
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
  data: {
    events: RedditConversionEvent[]
    test_mode?: boolean
  }
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
      event_at: Date.now(), // Unix epoch timestamp in milliseconds
      type: {
        tracking_type: params.eventType,
      },
      user: {
        email: params.email,
        external_id: params.externalId,
        ip_address: params.ipAddress,
        user_agent: params.userAgent,
      },
      metadata: {
        conversion_id: params.conversionId,
        currency: params.currency || 'USD',
        value: params.value,
      },
    }

    const payload: RedditCAPIPayload = {
      data: {
        events: [event],
        test_mode: params.testMode || false,
      },
    }

    // Use Reddit's v3 API endpoint as per their documentation
    const response = await fetch('https://ads-api.reddit.com/api/v3/pixels/a2_ie6pid7z8xzv/conversion_events', {
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
