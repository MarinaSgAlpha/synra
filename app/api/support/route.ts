import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const admin = createAdminClient()

    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { subject, message } = await request.json()

    if (!subject || !message) {
      return NextResponse.json({ error: 'Subject and message are required' }, { status: 400 })
    }

    // Insert support ticket
    const { error } = await admin
      .from('support_tickets')
      .insert({
        user_id: authUser.id,
        email: authUser.email,
        subject,
        message,
        status: 'open',
      })

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Support ticket error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
