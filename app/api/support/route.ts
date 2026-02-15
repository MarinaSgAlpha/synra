import { createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()

    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { subject, message } = await request.json()

    if (!subject || !message) {
      return NextResponse.json({ error: 'Subject and message are required' }, { status: 400 })
    }

    // Send email notification
    await resend.emails.send({
      from: 'Synra Support <onboarding@resend.dev>', // You'll change this to your domain later
      to: 'hello@mcpserver.design',
      replyTo: authUser.email || undefined,
      subject: `Support Request: ${subject}`,
      text: `
Support request from ${authUser.email}

Subject: ${subject}

Message:
${message}

---
User ID: ${authUser.id}
      `.trim(),
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Support email error:', error)
    return NextResponse.json({ error: 'Failed to send message. Please try emailing hello@mcpserver.design directly.' }, { status: 500 })
  }
}
