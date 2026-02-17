import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { nanoid } from 'nanoid'

export async function POST(request: NextRequest) {
  try {
    const { userId, email, name, companyName, companySize, useCase } = await request.json()

    if (!userId || !email || !name) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Use admin client (service role key) to bypass RLS for user setup
    const supabase = createAdminClient()

    // Check if user already exists (idempotency) — users.id = auth user id
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .single()

    if (existingUser) {
      return NextResponse.json({ message: 'User already set up' })
    }

    // Generate unique organization slug
    const orgSlug = `org-${nanoid(10)}`

    // 1. Create organization (use company name if provided)
    const orgName = companyName || `${name}'s Organization`
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({
        name: orgName,
        slug: orgSlug,
        plan: 'free',
        company_size: companySize || null,
        use_case: useCase || null,
      })
      .select()
      .single()

    if (orgError) throw new Error(`Failed to create organization: ${orgError.message}`)

    // 2. Create user record — use auth user ID as the users.id
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert({
        id: userId,
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
        status: 'active',
        joined_at: new Date().toISOString(),
      })

    if (memberError) throw new Error(`Failed to create membership: ${memberError.message}`)

    // 4. Create free subscription (unpaid trial)
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
