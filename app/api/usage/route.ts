import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// GET — fetch usage logs with filters
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const admin = createAdminClient()

    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's organization
    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', authUser.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'No organization found' }, { status: 404 })
    }

    // Parse query params
    const searchParams = request.nextUrl.searchParams
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')
    const status = searchParams.get('status') // 'success' | 'error' | null (all)

    // Build query
    let query = admin
      .from('usage_logs')
      .select(`
        id,
        tool_name,
        service_slug,
        response_status,
        duration_ms,
        tokens_used,
        error_message,
        created_at,
        credentials(name)
      `)
      .eq('organization_id', membership.organization_id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status) {
      query = query.eq('response_status', status)
    }

    const { data: logs, error } = await query

    if (error) throw error

    // Get summary stats
    const { data: stats } = await admin
      .from('usage_logs')
      .select('response_status, duration_ms, tokens_used', { count: 'exact' })
      .eq('organization_id', membership.organization_id)

    const totalRequests = stats?.length || 0
    const successCount = stats?.filter((s: any) => s.response_status === 'success').length || 0
    const errorCount = stats?.filter((s: any) => s.response_status === 'error').length || 0
    const avgDuration = stats?.length
      ? Math.round(stats.reduce((sum: number, s: any) => sum + (s.duration_ms || 0), 0) / stats.length)
      : 0
    const totalTokens = stats?.reduce((sum: number, s: any) => sum + (s.tokens_used || 0), 0) || 0

    // Format logs
    const formattedLogs = (logs || []).map((log: any) => ({
      id: log.id,
      tool_name: log.tool_name,
      service_slug: log.service_slug,
      response_status: log.response_status,
      duration_ms: log.duration_ms,
      tokens_used: log.tokens_used,
      error_message: log.error_message,
      created_at: log.created_at,
      credential_name: log.credentials?.name || 'Unknown',
    }))

    return NextResponse.json({
      logs: formattedLogs,
      stats: {
        total_requests: totalRequests,
        success_count: successCount,
        error_count: errorCount,
        avg_duration_ms: avgDuration,
        total_tokens: totalTokens,
      },
      pagination: {
        limit,
        offset,
        has_more: logs && logs.length === limit,
      },
    })
  } catch (error: any) {
    console.error('GET usage logs error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
