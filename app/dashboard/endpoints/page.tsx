'use client'

import { useEffect, useState } from 'react'

interface Endpoint {
  id: string
  endpoint_url: string
  service_slug: string
  is_active: boolean
  rate_limit: number
  allowed_tools: string[] | null
  created_at: string
  last_accessed_at: string | null
  credential_name: string
}

export default function EndpointsPage() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    loadEndpoints()
  }, [])

  const loadEndpoints = async () => {
    try {
      const res = await fetch('/api/endpoints')
      if (res.ok) {
        const { endpoints: data } = await res.json()
        setEndpoints(data || [])
      }
    } catch (err) {
      console.error('Error loading endpoints:', err)
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = (url: string, id: string) => {
    const fullUrl = `${window.location.origin}${url}`
    navigator.clipboard.writeText(fullUrl)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  if (loading) {
    return (
      <div className="max-w-5xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Endpoints</h1>
        </div>
        <div className="text-gray-400 text-sm">Loading...</div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Endpoints</h1>
        <p className="text-sm text-gray-400 mt-1">
          Your MCP gateway endpoints
        </p>
      </div>

      {endpoints.length > 0 ? (
        <div className="space-y-4">
          {endpoints.map((endpoint) => {
            const fullUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}${endpoint.endpoint_url}`
            const lastUsed = endpoint.last_accessed_at
              ? new Date(endpoint.last_accessed_at).toLocaleString()
              : 'Never'

            return (
              <div
                key={endpoint.id}
                className="bg-[#111] border border-[#1c1c1c] rounded-lg p-5"
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <h3 className="text-white font-medium">
                      {endpoint.credential_name}
                    </h3>
                    <span
                      className={`px-2 py-0.5 text-[10px] rounded-full border ${
                        endpoint.is_active
                          ? 'text-green-400 bg-green-500/10 border-green-500/20'
                          : 'text-gray-400 bg-gray-500/10 border-gray-500/20'
                      }`}
                    >
                      {endpoint.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] text-gray-500 bg-[#0a0a0a] border border-[#1c1c1c] rounded-full">
                      {endpoint.service_slug}
                    </span>
                  </div>
                </div>

                {/* Endpoint URL with copy button */}
                <div className="mb-4">
                  <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">
                    MCP Endpoint URL
                  </label>
                  <div className="flex items-center gap-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md p-3">
                    <code className="text-sm text-blue-400 font-mono flex-1 break-all">
                      {fullUrl}
                    </code>
                    <button
                      onClick={() => copyToClipboard(endpoint.endpoint_url, endpoint.id)}
                      className="px-3 py-1.5 text-xs bg-[#1c1c1c] hover:bg-[#252525] text-gray-300 hover:text-white rounded transition-all flex-shrink-0"
                    >
                      {copiedId === endpoint.id ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Rate Limit</p>
                    <p className="text-white">{endpoint.rate_limit} req/min</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Last Used</p>
                    <p className="text-white">{lastUsed}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Created</p>
                    <p className="text-white">
                      {new Date(endpoint.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                {/* Allowed tools */}
                {endpoint.allowed_tools && endpoint.allowed_tools.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-[#1c1c1c]">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                      Allowed Tools
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {endpoint.allowed_tools.map((tool) => (
                        <span
                          key={tool}
                          className="px-2 py-1 text-xs text-gray-300 bg-[#0a0a0a] border border-[#1c1c1c] rounded"
                        >
                          {tool}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-12 text-center">
          <div className="text-4xl mb-4">🔗</div>
          <h2 className="text-xl font-semibold text-white mb-2">No endpoints yet</h2>
          <p className="text-sm text-gray-400">
            Endpoints are automatically created when you add credentials.
          </p>
        </div>
      )}
    </div>
  )
}
