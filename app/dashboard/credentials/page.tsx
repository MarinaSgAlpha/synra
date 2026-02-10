'use client'

import { useEffect, useState } from 'react'
import { useDashboard } from '@/contexts/DashboardContext'
import type { SupportedService, Credential } from '@/types'

interface CredentialWithEndpoint {
  id: string
  name: string
  service_slug: string
  is_active: boolean
  created_at: string
  endpoint_url?: string
  test_queries_used?: number
}

export default function CredentialsPage() {
  const { user, organization } = useDashboard()
  const [credentials, setCredentials] = useState<CredentialWithEndpoint[]>([])
  const [services, setServices] = useState<SupportedService[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [hasPaidSubscription, setHasPaidSubscription] = useState(false)
  const [testResults, setTestResults] = useState<Record<string, any>>({})
  const [testingId, setTestingId] = useState<string | null>(null)

  // Form state
  const [selectedService, setSelectedService] = useState<SupportedService | null>(null)
  const [credName, setCredName] = useState('')
  const [configValues, setConfigValues] = useState<Record<string, string>>({})

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [credRes, svcRes, subRes] = await Promise.all([
        fetch('/api/credentials'),
        fetch('/api/services'),
        fetch('/api/auth/me'),
      ])

      if (credRes.ok) {
        const { credentials: creds } = await credRes.json()
        setCredentials(creds || [])
      }

      if (svcRes.ok) {
        const { services: svcs } = await svcRes.json()
        setServices(svcs || [])
      }

      // Check if user has paid subscription
      if (subRes.ok) {
        const { subscription } = await subRes.json()
        // User has paid if they have a Stripe subscription ID and it's active
        const hasPaid = subscription?.stripe_subscription_id && subscription?.status === 'active'
        setHasPaidSubscription(hasPaid || false)
      }
    } catch (err) {
      console.error('Error loading data:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleTestConnection = async (credentialId: string) => {
    setTestingId(credentialId)
    setTestResults((prev) => ({ ...prev, [credentialId]: null }))
    
    try {
      const res = await fetch('/api/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId }),
      })

      const data = await res.json()
      setTestResults((prev) => ({ ...prev, [credentialId]: data }))

      if (data.success) {
        // Reload credentials to get updated test_queries_used count
        await loadData()
      }
    } catch (err) {
      console.error('Test connection error:', err)
      setTestResults((prev) => ({ 
        ...prev, 
        [credentialId]: { success: false, error: 'Connection test failed' } 
      }))
    } finally {
      setTestingId(null)
    }
  }

  const handleSelectService = (service: SupportedService) => {
    setSelectedService(service)
    setConfigValues({})
    setError(null)
    setSuccess(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedService || !credName) return

    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const res = await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: credName,
          serviceSlug: selectedService.slug,
          config: configValues,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        
        // Handle upgrade requirement
        if (data.upgrade_required) {
          setError(`${data.error} - Upgrade your plan to add more credentials.`)
        } else {
          setError(data.error || 'Failed to create credential')
        }
        
        setSaving(false)
        return
      }

      const { credential, endpoint } = await res.json()

      setCredentials((prev) => [
        { ...credential, endpoint_url: endpoint.endpoint_url },
        ...prev,
      ])

      const fullUrl = `${window.location.origin}${endpoint.endpoint_url}`
      setSuccess(`Credential created! Your MCP endpoint: ${fullUrl}`)
      setShowForm(false)
      setCredName('')
      setConfigValues({})
      setSelectedService(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Get config fields from the service's config_schema
  const getConfigFields = (service: SupportedService) => {
    if (service.config_schema && Array.isArray(service.config_schema.fields)) {
      return service.config_schema.fields
    }
    // Fallback for Supabase if config_schema not populated
    if (service.slug === 'supabase') {
      return [
        { key: 'url', label: 'Supabase URL', type: 'url' as const, required: true, encrypted: false },
        { key: 'anon_key', label: 'Anon Key', type: 'password' as const, required: true, encrypted: true },
        { key: 'service_role_key', label: 'Service Role Key', type: 'password' as const, required: false, encrypted: true },
      ]
    }
    return []
  }

  if (loading) {
    return (
      <div className="max-w-5xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Credentials</h1>
        </div>
        <div className="text-gray-400 text-sm">Loading...</div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Credentials</h1>
          <p className="text-sm text-gray-400 mt-1">
            Manage your service connections
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => {
              setShowForm(true)
              setError(null)
              setSuccess(null)
            }}
            className="px-4 py-2 text-sm bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-medium rounded-md transition-all"
          >
            Add Credential
          </button>
        )}
      </div>

      {/* Success message */}
      {success && (
        <div className="mb-6 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
          <p className="text-sm text-green-400">{success}</p>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Add credential form */}
      {showForm && (
        <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-white">Add New Credential</h2>
            <button
              onClick={() => {
                setShowForm(false)
                setSelectedService(null)
              }}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>

          {/* Step 1: Select service */}
          {!selectedService ? (
            <div>
              <p className="text-sm text-gray-400 mb-4">Select a service to connect:</p>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {services.map((service) => (
                  <button
                    key={service.slug}
                    onClick={() => handleSelectService(service)}
                    className="text-left p-4 bg-[#0a0a0a] border border-[#1c1c1c] hover:border-blue-500/30 rounded-lg transition-all"
                  >
                    <h3 className="text-white font-medium mb-1">{service.name}</h3>
                    <p className="text-xs text-gray-500">{service.description || 'Connect your account'}</p>
                  </button>
                ))}
                {services.length === 0 && (
                  <p className="text-sm text-gray-500 col-span-full">
                    No services available. Check your supported_services table in Supabase.
                  </p>
                )}
              </div>
            </div>
          ) : (
            /* Step 2: Enter credentials */
            <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
              <div className="flex items-center gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => setSelectedService(null)}
                  className="text-sm text-gray-400 hover:text-white"
                >
                  ← Back
                </button>
                <span className="text-sm text-gray-500">|</span>
                <span className="text-sm text-blue-400">{selectedService.name}</span>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-2">
                  Connection Name
                </label>
                <input
                  type="text"
                  value={credName}
                  onChange={(e) => setCredName(e.target.value)}
                  required
                  placeholder={`My ${selectedService.name} Database`}
                  className="w-full px-4 py-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md text-white text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>

              {getConfigFields(selectedService).map((field) => (
                <div key={field.key}>
                  <label className="block text-sm text-gray-300 mb-2">
                    {field.label}
                    {field.required && <span className="text-red-400 ml-1">*</span>}
                  </label>
                  <input
                    type={field.type === 'password' ? 'password' : 'text'}
                    value={configValues[field.key] || ''}
                    onChange={(e) =>
                      setConfigValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                    required={field.required}
                    placeholder={field.type === 'url' ? 'https://...' : '••••••••'}
                    autoComplete="new-password"
                    data-1p-ignore
                    data-lpignore="true"
                    className="w-full px-4 py-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md text-white text-sm focus:border-blue-500 focus:outline-none font-mono"
                  />
                  {field.encrypted && (
                    <p className="text-[11px] text-gray-600 mt-1">
                      🔒 This value will be encrypted before storage
                    </p>
                  )}
                </div>
              ))}

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 text-sm bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-gray-600 disabled:to-gray-700 text-white font-medium rounded-md transition-all"
                >
                  {saving ? 'Saving...' : 'Save Credential'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false)
                    setSelectedService(null)
                  }}
                  className="px-5 py-2.5 text-sm bg-[#0a0a0a] border border-[#1c1c1c] text-gray-400 hover:text-white rounded-md transition-all"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Credentials list */}
      {credentials.length > 0 ? (
        <div className="space-y-3">
          {credentials.map((cred) => {
            const fullEndpointUrl = cred.endpoint_url
              ? `${typeof window !== 'undefined' ? window.location.origin : ''}${cred.endpoint_url}`
              : null
            const testQueriesUsed = cred.test_queries_used || 0
            const testQueriesRemaining = 3 - testQueriesUsed
            const testResult = testResults[cred.id]

            return (
              <div
                key={cred.id}
                className="bg-[#111] border border-[#1c1c1c] rounded-lg p-5"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <h3 className="text-white font-medium">{cred.name}</h3>
                    <span className={`px-2 py-0.5 text-[10px] rounded-full border ${
                      cred.is_active
                        ? 'text-green-400 bg-green-500/10 border-green-500/20'
                        : 'text-gray-400 bg-gray-500/10 border-gray-500/20'
                    }`}>
                      {cred.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <span className="text-xs text-gray-600">{cred.service_slug}</span>
                </div>

                {/* MCP Endpoint URL - Partially visible for unpaid users */}
                {fullEndpointUrl && (
                  <div className="mb-4">
                    <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">
                      MCP Endpoint URL
                    </label>
                    <div className="relative">
                      <div className="flex items-center gap-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md p-3">
                        <code className="text-sm text-blue-400 font-mono flex-1 truncate">
                          {hasPaidSubscription ? fullEndpointUrl : (() => {
                            // Show first part and last part, blur the middle
                            const url = new URL(fullEndpointUrl)
                            const pathParts = url.pathname.split('/')
                            const lastPart = pathParts[pathParts.length - 1]
                            return `${url.origin}/api/mcp/••••••${lastPart.slice(-4)}`
                          })()}
                        </code>
                        {hasPaidSubscription ? (
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(fullEndpointUrl)
                              setCopiedId(cred.id)
                              setTimeout(() => setCopiedId(null), 2000)
                            }}
                            className="px-3 py-1 text-xs bg-[#1c1c1c] hover:bg-[#252525] text-gray-300 hover:text-white rounded transition-all flex-shrink-0"
                          >
                            {copiedId === cred.id ? 'Copied!' : 'Copy'}
                          </button>
                        ) : (
                          <span className="px-3 py-1 text-xs text-gray-500 flex-shrink-0">
                            🔒 Hidden
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Test Connection Section */}
                {!hasPaidSubscription && (
                  <div className="bg-[#0a0a0a] border border-[#1c1c1c] rounded-lg p-4 mb-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="text-sm font-medium text-white mb-1">Test Connection</h4>
                        <p className="text-xs text-gray-500">
                          {testQueriesRemaining > 0 
                            ? `${testQueriesRemaining} free ${testQueriesRemaining === 1 ? 'query' : 'queries'} remaining`
                            : 'Test queries used up'}
                        </p>
                      </div>
                      <button
                        onClick={() => handleTestConnection(cred.id)}
                        disabled={testingId === cred.id || testQueriesRemaining <= 0}
                        className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {testingId === cred.id ? 'Testing...' : 'Test Connection'}
                      </button>
                    </div>

                    {/* Test Results */}
                    {testResult && (
                      <div className={`mt-3 p-3 rounded-md ${
                        testResult.success 
                          ? 'bg-green-500/10 border border-green-500/20' 
                          : 'bg-red-500/10 border border-red-500/20'
                      }`}>
                        <p className={`text-sm font-medium mb-2 ${
                          testResult.success ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {testResult.success ? '✅ ' : '❌ '}
                          {testResult.message || testResult.error}
                        </p>
                        {testResult.success && testResult.sample_data && (
                          <div className="text-xs text-gray-300 space-y-1.5">
                            {/* Show table count if available */}
                            {testResult.sample_data.table_count !== undefined && (
                              <p className="font-medium">
                                📊 {testResult.sample_data.table_count === 0 
                                  ? 'No tables yet' 
                                  : `${testResult.sample_data.table_count} table${testResult.sample_data.table_count === 1 ? '' : 's'} detected`}
                              </p>
                            )}
                            
                            {/* Show sample tables if available */}
                            {testResult.sample_data.sample_tables?.length > 0 && (
                              <p>
                                <span className="text-gray-400">Sample tables:</span>{' '}
                                <span className="text-blue-400 font-mono text-[11px]">
                                  {testResult.sample_data.sample_tables.join(', ')}
                                </span>
                              </p>
                            )}
                            
                            {/* Show AI insight */}
                            {testResult.sample_data.insight && (
                              <p className="text-gray-300 pt-1 border-t border-gray-700/50 italic">
                                💬 {testResult.sample_data.insight}
                              </p>
                            )}
                          </div>
                        )}
                        {testResult.details && (
                          <p className="text-xs text-gray-400 mt-2">
                            Details: {testResult.details}
                          </p>
                        )}
                        {testResult.limit_reached && (
                          <p className="text-xs text-yellow-400 mt-2">
                            💡 Subscribe to get unlimited queries
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Subscribe Button */}
                {!hasPaidSubscription && (
                  <div className="flex justify-center">
                    <a
                      href="/dashboard/settings"
                      className="inline-block px-6 py-2.5 bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white text-sm font-medium rounded-lg transition-all text-center whitespace-nowrap"
                    >
                      Subscribe to Unlock Full Access ($19/mo)
                    </a>
                  </div>
                )}

                <p className="text-xs text-gray-500 mt-3">
                  Created {new Date(cred.created_at).toLocaleDateString()}
                </p>
              </div>
            )
          })}
        </div>
      ) : (
        !showForm && (
          <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-12 text-center">
            <div className="text-4xl mb-4">🔑</div>
            <h2 className="text-xl font-semibold text-white mb-2">No credentials yet</h2>
            <p className="text-sm text-gray-400 mb-6">
              Add your first credential to connect a service to your MCP gateway.
            </p>
            <button
              onClick={() => setShowForm(true)}
              className="px-5 py-2.5 bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white text-sm font-medium rounded-md transition-all"
            >
              Add Credential
            </button>
          </div>
        )
      )}
    </div>
  )
}
