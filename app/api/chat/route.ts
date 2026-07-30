import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { SYNRA_SUPPORT_SYSTEM_PROMPT } from '@/lib/chat-system-prompt'

const DAILY_LIMIT = 20
// DeepSeek exposes an OpenAI-compatible chat completions API.
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions'
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat'
const MAX_TOKENS = 500

type ChatMessage = { role: 'user' | 'assistant'; content: string }

function startOfTodayUTC(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  try {
    const supabase = await createServerClient()
    const admin = createAdminClient()

    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const userMessage: string = (body?.message || '').toString().trim()
    const history: ChatMessage[] = Array.isArray(body?.conversationHistory)
      ? body.conversationHistory
          .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .slice(-20)
      : []

    if (!userMessage) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }
    if (userMessage.length > 2000) {
      return NextResponse.json({ error: 'Message too long (max 2000 chars)' }, { status: 400 })
    }

    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', authUser.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'No organization found' }, { status: 404 })
    }

    const organizationId = membership.organization_id

    // Daily limit check
    const { count: usedToday } = await admin
      .from('usage_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', authUser.id)
      .eq('tool_name', 'support_chat')
      .gte('created_at', startOfTodayUTC())

    if ((usedToday || 0) >= DAILY_LIMIT) {
      return NextResponse.json(
        {
          error: 'Daily message limit reached. You can send more messages tomorrow, or email us at hello@mcpserver.design.',
          limit_reached: true,
          used_today: usedToday,
          daily_limit: DAILY_LIMIT,
        },
        { status: 429 }
      )
    }

    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      console.error('DEEPSEEK_API_KEY is not set')
      return NextResponse.json(
        { error: "I'm having trouble right now. Please email hello@mcpserver.design for help." },
        { status: 500 }
      )
    }

    let assistantText = ''
    try {
      const apiRes = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          messages: [
            { role: 'system', content: SYNRA_SUPPORT_SYSTEM_PROMPT },
            ...history.map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: userMessage },
          ],
        }),
      })

      if (!apiRes.ok) {
        const errBody = await apiRes.text().catch(() => '')
        throw new Error(`DeepSeek API error ${apiRes.status}: ${errBody.slice(0, 300)}`)
      }

      const response = await apiRes.json()
      assistantText = (response.choices?.[0]?.message?.content || '').trim()

      const durationMs = Date.now() - startedAt

      await admin.from('usage_logs').insert({
        organization_id: organizationId,
        user_id: authUser.id,
        tool_name: 'support_chat',
        service_slug: 'synra_chat',
        request_data: { message: userMessage.slice(0, 500) },
        response_status: 'success',
        duration_ms: durationMs,
        tokens_used: response.usage?.total_tokens || 0,
      })

      const remaining = DAILY_LIMIT - ((usedToday || 0) + 1)

      return NextResponse.json({
        reply: assistantText,
        used_today: (usedToday || 0) + 1,
        remaining,
        daily_limit: DAILY_LIMIT,
      })
    } catch (err: any) {
      console.error('DeepSeek API error:', err)
      const durationMs = Date.now() - startedAt
      await admin.from('usage_logs').insert({
        organization_id: organizationId,
        user_id: authUser.id,
        tool_name: 'support_chat',
        service_slug: 'synra_chat',
        request_data: { message: userMessage.slice(0, 500) },
        response_status: 'error',
        error_message: err?.message?.slice(0, 500) || 'DeepSeek API call failed',
        duration_ms: durationMs,
      })

      return NextResponse.json(
        { error: "I'm having trouble right now. Please email hello@mcpserver.design for help." },
        { status: 502 }
      )
    }
  } catch (error: any) {
    console.error('Chat route error:', error)
    return NextResponse.json(
      { error: "I'm having trouble right now. Please email hello@mcpserver.design for help." },
      { status: 500 }
    )
  }
}
