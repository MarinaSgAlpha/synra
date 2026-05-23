import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

async function getAuthorizedCredential(id: string) {
  const supabase = await createServerClient()
  const admin = createAdminClient()

  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) return null

  const { data: membership } = await admin
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', authUser.id)
    .single()

  if (!membership) return null

  const { data: credential } = await admin
    .from('credentials')
    .select('id, organization_id, config')
    .eq('id', id)
    .eq('organization_id', membership.organization_id)
    .single()

  return credential
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const credential = await getAuthorizedCredential(id)

    if (!credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    const config = credential.config as Record<string, any>
    let allowedTables: string[] = []

    if (config.allowed_tables) {
      try {
        allowedTables = JSON.parse(config.allowed_tables)
      } catch {
        allowedTables = []
      }
    }

    return NextResponse.json({ allowed_tables: allowedTables })
  } catch (error: any) {
    console.error('GET tables error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const credential = await getAuthorizedCredential(id)

    if (!credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    const { allowed_tables } = await request.json()

    if (!Array.isArray(allowed_tables)) {
      return NextResponse.json({ error: 'allowed_tables must be an array' }, { status: 400 })
    }

    const admin = createAdminClient()
    const existingConfig = credential.config as Record<string, any>

    const updatedConfig = {
      ...existingConfig,
      allowed_tables: JSON.stringify(allowed_tables),
    }

    const { error: updateError } = await admin
      .from('credentials')
      .update({
        config: updatedConfig,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (updateError) {
      throw new Error(`Failed to update: ${updateError.message}`)
    }

    return NextResponse.json({ success: true, allowed_tables })
  } catch (error: any) {
    console.error('PATCH tables error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
