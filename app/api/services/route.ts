import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

// GET — list supported services
export async function GET() {
  try {
    const supabase = await createServerClient()

    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Use admin client to bypass RLS
    const admin = createAdminClient()

    const { data: services, error } = await admin
      .from('supported_services')
      .select('*')
      .eq('is_active', true)
      .order('name')

    if (error) throw error

    return NextResponse.json({ services })
  } catch (error: any) {
    console.error('GET services error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
