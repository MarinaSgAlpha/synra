import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

// Load .env.local
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Missing environment variables!')
  console.error('NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '✅' : '❌')
  console.error('SUPABASE_SERVICE_ROLE_KEY:', serviceRoleKey ? '✅' : '❌')
  process.exit(1)
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

async function checkCredentials() {
  console.log('🔍 Checking credentials in database...\n')

  // Get all credentials
  const { data: creds, error: credsError } = await admin
    .from('credentials')
    .select('*')
    .order('created_at', { ascending: false })

  if (credsError) {
    console.error('Error fetching credentials:', credsError)
    return
  }

  console.log(`Found ${creds?.length || 0} credentials:\n`)
  
  if (creds && creds.length > 0) {
    for (const cred of creds) {
      console.log(`Credential: ${cred.name}`)
      console.log(`  ID: ${cred.id}`)
      console.log(`  Organization ID: ${cred.organization_id}`)
      console.log(`  Service: ${cred.service_slug}`)
      console.log(`  Active: ${cred.is_active}`)
      console.log(`  Test Queries Used: ${cred.test_queries_used || 'N/A (column missing)'}`)
      console.log(`  Created: ${cred.created_at}`)
      
      // Get associated endpoint
      const { data: endpoint } = await admin
        .from('mcp_endpoints')
        .select('endpoint_url')
        .eq('credential_id', cred.id)
        .single()
      
      console.log(`  Endpoint: ${endpoint?.endpoint_url || 'None'}\n`)
    }
  }

  // Get all organizations
  console.log('\n📊 Organizations:')
  const { data: orgs } = await admin
    .from('organizations')
    .select('*')
    .order('created_at', { ascending: false })

  if (orgs && orgs.length > 0) {
    for (const org of orgs) {
      console.log(`\nOrg: ${org.name}`)
      console.log(`  ID: ${org.id}`)
      console.log(`  Slug: ${org.slug}`)
      console.log(`  Plan: ${org.plan}`)
    }
  }

  // Get all users
  console.log('\n👤 Users:')
  const { data: users } = await admin
    .from('users')
    .select('*')
    .order('created_at', { ascending: false })

  if (users && users.length > 0) {
    for (const user of users) {
      console.log(`\nUser: ${user.name || user.email}`)
      console.log(`  ID: ${user.id}`)
      console.log(`  Email: ${user.email}`)
      
      // Get membership
      const { data: membership } = await admin
        .from('organization_members')
        .select('organization_id, role')
        .eq('user_id', user.id)
        .single()
      
      if (membership) {
        console.log(`  Organization ID: ${membership.organization_id}`)
        console.log(`  Role: ${membership.role}`)
      } else {
        console.log(`  ⚠️ No organization membership!`)
      }
    }
  }
}

checkCredentials()
