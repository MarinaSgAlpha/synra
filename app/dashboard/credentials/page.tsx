'use client'

import { useEffect, useState } from 'react'
import { useDashboard } from '@/contexts/DashboardContext'
import type { SupportedService } from '@/types'

interface ConnectionItem {
  id: string
  name: string
  service_slug: string
  is_active: boolean
  created_at: string
  endpoint_url?: string
  test_queries_used?: number
  rate_limit?: number
  last_accessed_at?: string | null
  endpoint_created_at?: string | null
}

export default function ConnectionsPage() {
  const { user, organization } = useDashboard()
  const [connections, setConnections] = useState<ConnectionItem[]>([])
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [showPricingModal, setShowPricingModal] = useState(false)

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
        setConnections(creds || [])
      }

      if (svcRes.ok) {
        const { services: svcs } = await svcRes.json()
        setServices(svcs || [])
      }

      if (subRes.ok) {
        const { subscription } = await subRes.json()
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
    // Default SSL to true for PostgreSQL
    const defaultConfig: Record<string, string> = 
      service.slug === 'postgresql' || service.slug === 'mysql' ? { ssl: 'true' } : {}
    setConfigValues(defaultConfig)
    setError(null)
    setSuccess(null)
    setEditingId(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedService || !credName) return

    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      if (editingId) {
        // Update existing credential
        const res = await fetch('/api/credentials', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editingId,
            name: credName,
            config: configValues,
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          setError(data.error || 'Failed to update connection')
          setSaving(false)
          return
        }

        const { credential } = await res.json()

        setConnections((prev) =>
          prev.map((c) => (c.id === editingId ? { ...c, ...credential } : c))
        )

        setSuccess('Connection updated successfully!')
        setShowForm(false)
        setCredName('')
        setConfigValues({})
        setSelectedService(null)
        setEditingId(null)
      } else {
        // Create new credential
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
          if (data.upgrade_required) {
            setError(`${data.error} - Upgrade your plan to add more connections.`)
          } else {
            setError(data.error || 'Failed to create connection')
          }
          setSaving(false)
          return
        }

        const { credential, endpoint } = await res.json()

        setConnections((prev) => [
          { ...credential, endpoint_url: endpoint.endpoint_url },
          ...prev,
        ])

        const fullUrl = `${window.location.origin}${endpoint.endpoint_url}`
        setSuccess(`Connection created! Your MCP endpoint: ${fullUrl}`)
        
        // Track Lead event (first connection created)
        if (typeof window !== 'undefined' && (window as any).rdt && connections.length === 0) {
          (window as any).rdt('track', 'Lead', {
            conversionId: credential.id
          })
        }
        
        setShowForm(false)
        setCredName('')
        setConfigValues({})
        setSelectedService(null)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = async (conn: ConnectionItem) => {
    // Find the service
    const service = services.find((s) => s.slug === conn.service_slug)
    if (!service) return

    setSelectedService(service)
    setCredName(conn.name)
    setEditingId(conn.id)
    setShowForm(true)
    setError(null)
    setSuccess(null)

    // Fetch the full credential config (non-sensitive fields will be readable)
    try {
      const res = await fetch(`/api/credentials/${conn.id}`)
      if (res.ok) {
        const { credential } = await res.json()
        // Pre-populate non-encrypted fields from config
        const config = credential.config || {}
        const nonEncryptedValues: Record<string, string> = {}
        
        // Only populate fields that are NOT marked as encrypted in the schema
        const fields = getConfigFields(service)
        for (const field of fields) {
          if (!field.encrypted && config[field.key]) {
            nonEncryptedValues[field.key] = config[field.key]
          }
        }
        
        setConfigValues(nonEncryptedValues)
      }
    } catch (err) {
      // If fetch fails, just start with empty values
      setConfigValues({})
    }
  }

  const handleDelete = async (id: string) => {
    setError(null)
    setSuccess(null)

    try {
      const res = await fetch('/api/credentials', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to delete connection')
        return
      }

      setConnections((prev) => prev.filter((c) => c.id !== id))
      setSuccess('Connection deleted successfully')
      setDeleteConfirmId(null)
    } catch (err: any) {
      setError(err.message)
    }
  }

  const getConfigFields = (service: SupportedService) => {
    // Always use hardcoded fields for known services (includes hints + placeholders)
    if (service.slug === 'supabase') {
      return [
        {
          key: 'url',
          label: 'Supabase Project URL',
          type: 'url' as const,
          required: true,
          encrypted: false,
          placeholder: 'https://your-project-id.supabase.co',
          hint: 'Supabase → Settings → General → copy Project ID, then use https://<project-id>.supabase.co',
        },
        {
          key: 'service_role_key',
          label: 'Service Role Key',
          type: 'password' as const,
          required: true,
          encrypted: true,
          placeholder: '',
          hint: 'Supabase → Settings → API Keys → Secret key → reveal and copy',
        },
      ]
    }
    if (service.slug === 'postgresql') {
      return [
        {
          key: 'host',
          label: 'Host',
          type: 'text' as const,
          required: true,
          encrypted: false,
          placeholder: 'db.example.com',
          hint: 'Your database host address (e.g. from Neon, Railway, RDS, etc.)',
        },
        {
          key: 'port',
          label: 'Port',
          type: 'text' as const,
          required: true,
          encrypted: false,
          placeholder: '5432',
          hint: 'Usually 5432 for PostgreSQL',
        },
        {
          key: 'database',
          label: 'Database Name',
          type: 'text' as const,
          required: true,
          encrypted: false,
          placeholder: 'mydb',
          hint: 'The name of the database to connect to',
        },
        {
          key: 'user',
          label: 'Username',
          type: 'text' as const,
          required: true,
          encrypted: false,
          placeholder: 'postgres',
          hint: 'Your database username',
        },
        {
          key: 'password',
          label: 'Password',
          type: 'password' as const,
          required: true,
          encrypted: true,
          placeholder: '',
          hint: 'Your database password',
        },
        {
          key: 'ssl',
          label: 'Require SSL',
          type: 'checkbox' as const,
          required: false,
          encrypted: false,
          hint: 'Enable for cloud-hosted databases (recommended)',
        },
      ]
    }
    if (service.slug === 'mysql') {
      return [
        {
          key: 'host',
          label: 'Host',
          type: 'text' as const,
          required: true,
          encrypted: false,
          placeholder: 'db.example.com',
          hint: 'Your MySQL host (e.g. PlanetScale, AWS RDS, Railway)',
        },
        {
          key: 'port',
          label: 'Port',
          type: 'text' as const,
          required: false,
          encrypted: false,
          placeholder: '3306',
          hint: 'Usually 3306 for MySQL',
        },
        {
          key: 'database',
          label: 'Database Name',
          type: 'text' as const,
          required: true,
          encrypted: false,
          placeholder: 'mydb',
          hint: 'The name of the database to connect to',
        },
        {
          key: 'user',
          label: 'Username',
          type: 'text' as const,
          required: true,
          encrypted: false,
          placeholder: 'root',
          hint: 'Your database username',
        },
        {
          key: 'password',
          label: 'Password',
          type: 'password' as const,
          required: true,
          encrypted: true,
          placeholder: '',
          hint: 'Your database password',
        },
        {
          key: 'ssl',
          label: 'Require SSL',
          type: 'checkbox' as const,
          required: false,
          encrypted: false,
          hint: 'Enable for cloud-hosted databases (recommended)',
        },
      ]
    }
    if (service.config_schema && Array.isArray(service.config_schema.fields)) {
      return service.config_schema.fields
    }
    return []
  }

  if (loading) {
    return (
      <div className="max-w-5xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Connections</h1>
        </div>
        <div className="text-gray-400 text-sm">Loading...</div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Connections</h1>
          <p className="text-sm text-gray-400 mt-1">
            Manage your service connections and MCP endpoints
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
            Add Connection
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

      {/* Add connection form */}
      {showForm && (
        <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-white">
              {editingId ? 'Edit Connection' : 'Add New Connection'}
            </h2>
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
                    className="text-left p-4 bg-[#0a0a0a] border border-green-500/30 hover:border-green-500/60 rounded-lg transition-all group"
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-2xl">⚡</span>
                      <h3 className="text-white font-semibold group-hover:text-green-400 transition-colors">
                        {service.name}
                      </h3>
                    </div>
                    <p className="text-xs text-gray-500 leading-relaxed">
                      {service.description || 'Connect your Supabase database to AI assistants via MCP'}
                    </p>
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

              {editingId && (
                <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-3 mb-4">
                  <p className="text-xs text-blue-400">
                    🔒 For security, sensitive fields (passwords, API keys) are encrypted and must be re-entered.
                  </p>
                </div>
              )}

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
                  {field.type === 'checkbox' ? (
                    <label className="flex items-center gap-3 cursor-pointer py-1">
                      <input
                        type="checkbox"
                        checked={configValues[field.key] === 'true'}
                        onChange={(e) =>
                          setConfigValues((prev) => ({
                            ...prev,
                            [field.key]: e.target.checked ? 'true' : 'false',
                          }))
                        }
                        className="w-4 h-4 rounded border-[#1c1c1c] bg-[#0a0a0a] text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                      />
                      <span className="text-sm text-gray-300">{field.label}</span>
                      {field.hint && (
                        <span className="text-[11px] text-gray-500 font-normal">
                          ({field.hint})
                        </span>
                      )}
                    </label>
                  ) : (
                    <>
                      <label className="block text-sm text-gray-300 mb-1">
                        {field.label}
                        {field.required && <span className="text-red-400 ml-1">*</span>}
                        {field.hint && (
                          <span className="text-[11px] text-gray-500 font-normal ml-2">
                            ({field.hint})
                          </span>
                        )}
                      </label>
                      <input
                        type={field.type === 'password' ? 'password' : 'text'}
                        value={configValues[field.key] || ''}
                        onChange={(e) =>
                          setConfigValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                        }
                        required={field.required}
                        placeholder={field.placeholder || ''}
                        autoComplete="new-password"
                        data-1p-ignore
                        data-lpignore="true"
                        className="w-full px-4 py-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md text-white text-sm focus:border-blue-500 focus:outline-none font-mono mt-1"
                      />
                      {field.encrypted && (
                        <p className="text-[11px] text-gray-600 mt-1">
                          🔒 This value will be encrypted before storage
                        </p>
                      )}
                    </>
                  )}
                </div>
              ))}

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 text-sm bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-gray-600 disabled:to-gray-700 text-white font-medium rounded-md transition-all"
                >
                  {saving ? 'Saving...' : editingId ? 'Update Connection' : 'Save Connection'}
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

      {/* Connections list */}
      {!showForm && connections.length > 0 ? (
        <div className="space-y-3">
          {connections.map((conn) => {
            const fullEndpointUrl = conn.endpoint_url
              ? `${typeof window !== 'undefined' ? window.location.origin : ''}${conn.endpoint_url}`
              : null
            const testQueriesUsed = conn.test_queries_used || 0
            const testQueriesRemaining = 10 - testQueriesUsed
            const testResult = testResults[conn.id]
            const lastUsed = conn.last_accessed_at
              ? new Date(conn.last_accessed_at).toLocaleString()
              : 'Never'

            return (
              <div
                key={conn.id}
                className="bg-[#111] border border-[#1c1c1c] rounded-lg p-5"
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <h3 className="text-white font-medium">{conn.name}</h3>
                    <span className={`px-2 py-0.5 text-[10px] rounded-full border ${
                      conn.is_active
                        ? 'text-green-400 bg-green-500/10 border-green-500/20'
                        : 'text-gray-400 bg-gray-500/10 border-gray-500/20'
                    }`}>
                      {conn.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] text-gray-500 bg-[#0a0a0a] border border-[#1c1c1c] rounded-full">
                      {conn.service_slug}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEdit(conn)}
                      className="px-3 py-1 text-xs text-gray-400 hover:text-white bg-[#0a0a0a] hover:bg-[#1c1c1c] border border-[#1c1c1c] rounded transition-all"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(conn.id)}
                      className="px-3 py-1 text-xs text-red-400 hover:text-red-300 bg-red-500/5 hover:bg-red-500/10 border border-red-500/20 rounded transition-all"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* MCP Endpoint URL */}
                {fullEndpointUrl && (
                  <div className="mb-4">
                    <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">
                      MCP Endpoint URL
                    </label>
                    <div className="relative">
                      <div className="flex items-center gap-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md p-3">
                        <code className="text-sm text-blue-400 font-mono flex-1 truncate">
                          {fullEndpointUrl}
                        </code>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(fullEndpointUrl)
                            setCopiedId(conn.id)
                            setTimeout(() => setCopiedId(null), 2000)
                          }}
                          className="px-3 py-1 text-xs bg-[#1c1c1c] hover:bg-[#252525] text-gray-300 hover:text-white rounded transition-all flex-shrink-0"
                        >
                          {copiedId === conn.id ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Endpoint Stats */}
                <div className="grid grid-cols-3 gap-4 text-sm mb-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Rate Limit</p>
                    <p className="text-white">{conn.rate_limit || 100} req/min</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Last Used</p>
                    <p className="text-white">{lastUsed}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Created</p>
                    <p className="text-white">{new Date(conn.created_at).toLocaleDateString()}</p>
                  </div>
                </div>

                {/* Test Connection Section */}
                <div className="bg-[#0a0a0a] border border-[#1c1c1c] rounded-lg p-4 mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h4 className="text-sm font-medium text-white mb-1">Test Connection</h4>
                      <p className="text-xs text-gray-500">Verify your database connection is working</p>
                    </div>
                    <button
                      onClick={() => handleTestConnection(conn.id)}
                      disabled={testingId === conn.id}
                      className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {testingId === conn.id ? 'Testing...' : 'Test Connection'}
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
                        <div className="text-xs text-gray-300 space-y-2">
                          {testResult.sample_data.table_count !== undefined && (
                            <div className="flex items-center gap-2">
                              <span className="text-xl">📊</span>
                              <div>
                                <p className="font-medium text-white">
                                  {testResult.sample_data.table_count === 0 
                                    ? 'No tables yet' 
                                    : `${testResult.sample_data.table_count} table${testResult.sample_data.table_count === 1 ? '' : 's'} detected`}
                                </p>
                                {testResult.sample_data.sample_tables?.length > 0 && (
                                  <p className="text-gray-400 text-[11px] mt-0.5">
                                    <span className="font-mono text-blue-400">
                                      {testResult.sample_data.sample_tables.join(', ')}
                                    </span>
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                          
                          {testResult.sample_data.claude_says && (
                            <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-3 mt-2">
                              <p className="text-sm text-gray-200 leading-relaxed">
                                {testResult.sample_data.claude_says}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                      {testResult.details && (
                        <p className="text-xs text-gray-400 mt-2">
                          Details: {testResult.details}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        !showForm && (
          <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-12 text-center">
            <div className="text-4xl mb-4">🔗</div>
            <h2 className="text-xl font-semibold text-white mb-2">No connections yet</h2>
            <p className="text-sm text-gray-400 mb-6">
              Add your first connection to start using AI with your data.
            </p>
            <button
              onClick={() => setShowForm(true)}
              className="px-5 py-2.5 bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white text-sm font-medium rounded-md transition-all"
            >
              Add Connection
            </button>
          </div>
        )
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-white mb-3">Delete Connection?</h3>
            <p className="text-sm text-gray-400 mb-6">
              This will permanently delete this connection and its MCP endpoint. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => handleDelete(deleteConfirmId)}
                className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded transition-all"
              >
                Delete
              </button>
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 px-4 py-2 bg-[#0a0a0a] hover:bg-[#1c1c1c] text-gray-300 hover:text-white text-sm font-medium rounded border border-[#1c1c1c] transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pricing Modal */}
      {showPricingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-8 max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-2xl font-bold text-white mb-2">Choose Your Plan</h3>
                <p className="text-sm text-gray-400">Select a plan to unlock full access</p>
              </div>
              <button
                onClick={() => setShowPricingModal(false)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Starter Monthly */}
              <div className="bg-[#0a0a0a] border border-[#1c1c1c] rounded-lg p-6 flex flex-col">
                <div className="mb-4">
                  <h4 className="text-lg font-semibold text-white mb-2">Starter</h4>
                  <div className="flex items-baseline gap-1 mb-1">
                    <span className="text-3xl font-bold text-white">$19</span>
                    <span className="text-gray-400">/month</span>
                  </div>
                  <p className="text-xs text-gray-500">Cancel anytime</p>
                </div>

                <ul className="space-y-2 text-sm text-gray-300 mb-6 flex-grow">
                  <li className="flex items-start gap-2">
                    <span className="text-green-400 flex-shrink-0">✓</span>
                    <span>2 database connections</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-400 flex-shrink-0">✓</span>
                    <span>10,000 requests/day</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-400 flex-shrink-0">✓</span>
                    <span>PostgreSQL & Supabase</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-400 flex-shrink-0">✓</span>
                    <span>Read-only by default</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-400 flex-shrink-0">✓</span>
                    <span>AES-256 encryption</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-400 flex-shrink-0">✓</span>
                    <span>Full audit logs</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-400 flex-shrink-0">✓</span>
                    <span>Email support</span>
                  </li>
                </ul>

                <button
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/stripe/create-checkout-session', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ plan: 'starter' }),
                      })
                      const data = await res.json()
                      if (data.url) {
                        window.location.href = data.url
                      } else {
                        setError(data.error || 'Failed to start checkout')
                        setShowPricingModal(false)
                      }
                    } catch (err) {
                      setError('Failed to start checkout')
                      setShowPricingModal(false)
                    }
                  }}
                  className="w-full px-4 py-3 border-2 border-blue-500 hover:border-blue-400 bg-transparent text-blue-400 hover:text-blue-300 text-center text-sm font-medium rounded-lg transition-all"
                >
                  Start Monthly Plan
                </button>
              </div>

              {/* Lifetime */}
              <div className="bg-[#0a0a0a] border-2 border-blue-500/50 rounded-lg p-6 flex flex-col relative">
                <div className="absolute top-0 right-0 bg-gradient-to-br from-blue-500 to-blue-600 text-white text-[10px] font-bold px-3 py-1 rounded-bl-lg rounded-tr-lg">
                  LIMITED TIME
                </div>

                <div className="mb-4 mt-2">
                  <h4 className="text-lg font-semibold text-white mb-2">Lifetime Access</h4>
                  <div className="flex items-baseline gap-1 mb-1">
                    <span className="text-3xl font-bold text-white">$69</span>
                    <span className="text-gray-400">one-time</span>
                  </div>
                  <p className="text-xs text-green-400">Pay once, use forever</p>
                </div>

                <ul className="space-y-2 text-sm text-gray-300 mb-6 flex-grow">
                  <li className="flex items-start gap-2">
                    <span className="text-green-400 flex-shrink-0">✓</span>
                    <span>2 database connections</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-400 flex-shrink-0">✓</span>
                    <span>10,000 requests/day</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-400 flex-shrink-0">✓</span>
                    <span>PostgreSQL & Supabase</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-400 flex-shrink-0">✓</span>
                    <span>Read-only by default</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-400 flex-shrink-0">✓</span>
                    <span>AES-256 encryption</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-400 flex-shrink-0">✓</span>
                    <span>Full audit logs</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-400 flex-shrink-0">✓</span>
                    <span>Email support</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-400 flex-shrink-0">★</span>
                    <span className="text-blue-400 font-medium">Lifetime updates</span>
                  </li>
                </ul>

                <button
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/stripe/create-checkout-session', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ plan: 'lifetime' }),
                      })
                      const data = await res.json()
                      if (data.url) {
                        window.location.href = data.url
                      } else {
                        setError(data.error || 'Failed to start checkout')
                        setShowPricingModal(false)
                      }
                    } catch (err) {
                      setError('Failed to start checkout')
                      setShowPricingModal(false)
                    }
                  }}
                  className="w-full px-4 py-3 bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white text-center text-sm font-bold rounded-lg transition-all shadow-lg shadow-blue-500/20"
                >
                  Get Lifetime Access
                </button>

                <p className="text-center text-xs text-gray-500 mt-3">
                  One payment. No recurring fees.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
