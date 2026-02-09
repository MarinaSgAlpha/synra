import { createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { nanoid } from 'nanoid'

export async function POST(request: NextRequest) {
  try {
    const { userId, email, name } = await request.json()

    if (!userId || !email || !name) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const supabase = await createServerClient()

    // Check if user already exists (idempotency)
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('auth_user_id', userId)
      .single()

    if (existingUser) {
      return NextResponse.json({ message: 'User already set up' })
    }

    // Generate unique organization slug
    const orgSlug = `org-${nanoid(10)}`

    // 1. Create organization
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({
        name: `${name}'s Organization`,
        slug: orgSlug,
      })
      .select()
      .single()

    if (orgError) throw new Error(`Failed to create organization: ${orgError.message}`)

    // 2. Create user record
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert({
        auth_user_id: userId,
        email,
        name,
      })
      .select()
      .single()

    if (userError) throw new Error(`Failed to create user: ${userError.message}`)

    // 3. Create organization membership (owner role)
    const { error: memberError } = await supabase
      .from('organization_members')
      .insert({
        organization_id: org.id,
        user_id: user.id,
        role: 'owner',
      })

    if (memberError) throw new Error(`Failed to create membership: ${memberError.message}`)

    // 4. Create free subscription
    const { error: subscriptionError } = await supabase
      .from('subscriptions')
      .insert({
        organization_id: org.id,
        plan: 'free',
        status: 'active',
      })

    if (subscriptionError) throw new Error(`Failed to create subscription: ${subscriptionError.message}`)

    return NextResponse.json({
      message: 'User setup complete',
      organizationId: org.id,
      userId: user.id,
    })
  } catch (error: any) {
    console.error('Setup user error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
