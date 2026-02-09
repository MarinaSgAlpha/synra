import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// GET — list supported services
export async function GET() {
  try {
    const supabase = await createServerClient()

    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: services, error } = await supabase
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
