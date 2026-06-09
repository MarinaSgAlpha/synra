import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { SYNRA_SUPPORT_SYSTEM_PROMPT } from '@/lib/chat-system-prompt'

const DAILY_LIMIT = 20
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5'
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

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY is not set')
      return NextResponse.json(
        { error: "I'm having trouble right now. Please email hello@mcpserver.design for help." },
        { status: 500 }
      )
    }

    const anthropic = new Anthropic({ apiKey })

    let assistantText = ''
    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYNRA_SUPPORT_SYSTEM_PROMPT,
        messages: [
          ...history.map((m) => ({ role: m.role, content: m.content })),
          { role: 'user' as const, content: userMessage },
        ],
      })

      assistantText = response.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n')
        .trim()

      const durationMs = Date.now() - startedAt

      await admin.from('usage_logs').insert({
        organization_id: organizationId,
        user_id: authUser.id,
        tool_name: 'support_chat',
        service_slug: 'synra_chat',
        request_data: { message: userMessage.slice(0, 500) },
        response_status: 'success',
        duration_ms: durationMs,
        tokens_used:
          (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
      })

      const remaining = DAILY_LIMIT - ((usedToday || 0) + 1)

      return NextResponse.json({
        reply: assistantText,
        used_today: (usedToday || 0) + 1,
        remaining,
        daily_limit: DAILY_LIMIT,
      })
    } catch (err: any) {
      console.error('Claude API error:', err)
      const durationMs = Date.now() - startedAt
      await admin.from('usage_logs').insert({
        organization_id: organizationId,
        user_id: authUser.id,
        tool_name: 'support_chat',
        service_slug: 'synra_chat',
        request_data: { message: userMessage.slice(0, 500) },
        response_status: 'error',
        error_message: err?.message?.slice(0, 500) || 'Anthropic API call failed',
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
