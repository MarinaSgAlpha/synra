import { NextRequest, NextResponse } from 'next/server'

/**
 * Test endpoint for Reddit CAPI
 * Call this to send a test Purchase event to Reddit
 */
async function sendTestEvent() {
  const accessToken = process.env.REDDIT_CAPI_ACCESS_TOKEN

  if (!accessToken) {
    return { error: 'REDDIT_CAPI_ACCESS_TOKEN not set' }
  }

  // Test event payload (regular event for testing)
  const payload = {
    data: {
      events: [
        {
          event_at: Date.now(),
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
    return { error: `Reddit API error: ${response.status}`, details: errorText }
  }

  const result = await response.json()
  return { success: true, message: 'Test event sent to Reddit!', result }
}

export async function GET(request: NextRequest) {
  try {
    const result = await sendTestEvent()
    return NextResponse.json(result)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const result = await sendTestEvent()
    return NextResponse.json(result)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
