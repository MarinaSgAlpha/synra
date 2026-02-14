import { NextRequest, NextResponse } from 'next/server'

/**
 * Test endpoint for Reddit CAPI
 * Call this to send a test Purchase event to Reddit
 */
export async function POST(request: NextRequest) {
  try {
    const accessToken = process.env.REDDIT_CAPI_ACCESS_TOKEN

    if (!accessToken) {
      return NextResponse.json({ error: 'REDDIT_CAPI_ACCESS_TOKEN not set' }, { status: 500 })
    }

    // Test event payload
    const payload = {
      data: {
        events: [
          {
            event_at: Date.now(),
            action_source: 'website',
            type: {
              tracking_type: 'Purchase',
            },
            user: {
              email: 'test@example.com',
              external_id: 'test_user_123',
            },
            metadata: {
              conversion_id: 'test_conversion_123',
              currency: 'USD',
              value: 69,
            },
            test_id: 't2_1v8win9hr2', // Reddit's test ID
          },
        ],
      },
    }

    const response = await fetch(
      'https://ads-api.reddit.com/api/v3/pixels/a2_ie6pid7z8xzv/conversion_events',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      return NextResponse.json(
        { error: `Reddit API error: ${response.status}`, details: errorText },
        { status: response.status }
      )
    }

    const result = await response.json()
    return NextResponse.json({
      success: true,
      message: 'Test event sent to Reddit!',
      result,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
