import { createServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

/**
 * Root of the app subdomain. This is a server-side splitter:
 *   - signed-in users  → /dashboard
 *   - everyone else    → marketing site at https://mcpserver.design
 *
 * The middleware does the same thing first so we usually short-circuit
 * before this component is even invoked. Kept as a safety net so a
 * future middleware-matcher tweak can't accidentally expose a blank
 * or stale landing page.
 */
export default async function HomePage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect('/dashboard')
  }
  redirect('https://mcpserver.design')
}
