// Run with: npx tsx scripts/delete-test-user.ts
// Deletes the test user and all associated data so you can sign up fresh

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function deleteTestUser() {
  console.log('Looking for test user...')

  // Find the auth user by email
  const { data: { users }, error: listError } = await admin.auth.admin.listUsers()

  if (listError) {
    console.error('Error listing users:', listError.message)
    return
  }

  const testUser = users.find(u => u.email === 'sam.pil82@gmail.com')

  if (!testUser) {
    console.log('No test user found with that email.')
    return
  }

  console.log(`Found user: ${testUser.email} (${testUser.id})`)

  // Delete from our tables first (order matters due to foreign keys)
  // 1. organization_members
  const { data: membership } = await admin
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', testUser.id)
    .single()

  if (membership) {
    console.log(`Found org: ${membership.organization_id}`)

    // Delete subscriptions
    await admin.from('subscriptions').delete().eq('organization_id', membership.organization_id)
    console.log('Deleted subscriptions')

    // Delete credentials
    await admin.from('credentials').delete().eq('organization_id', membership.organization_id)
    console.log('Deleted credentials')

    // Delete mcp_endpoints
    await admin.from('mcp_endpoints').delete().eq('organization_id', membership.organization_id)
    console.log('Deleted mcp_endpoints')

    // Delete usage_logs
    await admin.from('usage_logs').delete().eq('organization_id', membership.organization_id)
    console.log('Deleted usage_logs')

    // Delete api_keys
    await admin.from('api_keys').delete().eq('organization_id', membership.organization_id)
    console.log('Deleted api_keys')

    // Delete audit_logs
    await admin.from('audit_logs').delete().eq('organization_id', membership.organization_id)
    console.log('Deleted audit_logs')

    // Delete invitations
    await admin.from('invitations').delete().eq('organization_id', membership.organization_id)
    console.log('Deleted invitations')

    // Delete organization_members
    await admin.from('organization_members').delete().eq('organization_id', membership.organization_id)
    console.log('Deleted organization_members')

    // Delete organization
    await admin.from('organizations').delete().eq('id', membership.organization_id)
    console.log('Deleted organization')
  }

  // Delete user record
  await admin.from('users').delete().eq('id', testUser.id)
  console.log('Deleted user record')

  // Delete auth user
  const { error: deleteError } = await admin.auth.admin.deleteUser(testUser.id)
  if (deleteError) {
    console.error('Error deleting auth user:', deleteError.message)
  } else {
    console.log('Deleted auth user')
  }

  console.log('\nDone! You can now sign up fresh.')
}

deleteTestUser().catch(console.error)
