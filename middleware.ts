import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request)

  // Redirect old endpoints route to connections page
  if (request.nextUrl.pathname === '/dashboard/endpoints') {
    return NextResponse.redirect(new URL('/dashboard/credentials', request.url))
  }

  // Protected dashboard routes
  if (request.nextUrl.pathname.startsWith('/dashboard')) {
    if (!user) {
      // Redirect to login if not authenticated
      const redirectUrl = new URL('/login', request.url)
      redirectUrl.searchParams.set('redirect', request.nextUrl.pathname)
      return NextResponse.redirect(redirectUrl)
    }
  }

  // Redirect logged-in users away from login page
  if (request.nextUrl.pathname === '/login' && user) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     * - api/mcp (MCP endpoints must be publicly accessible)
     */
    '/((?!_next/static|_next/image|favicon.ico|synraico.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$|api/mcp).*)',
  ],
}
