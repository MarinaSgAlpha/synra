'use client'

import { useEffect, useState } from 'react'

interface UsageLog {
  id: string
  tool_name: string
  service_slug: string
  response_status: 'success' | 'error'
  duration_ms: number | null
  tokens_used: number | null
  error_message: string | null
  created_at: string
  credential_name: string
}

interface UsageStats {
  total_requests: number
  success_count: number
  error_count: number
  avg_duration_ms: number
  total_tokens: number
}

export default function UsagePage() {
  const [logs, setLogs] = useState<UsageLog[]>([])
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'success' | 'error'>('all')

  useEffect(() => {
    loadUsage()
  }, [filter])

  const loadUsage = async () => {
    setLoading(true)
    try {
      const statusParam = filter !== 'all' ? `?status=${filter}` : ''
      const res = await fetch(`/api/usage${statusParam}`)
      if (res.ok) {
        const { logs: data, stats: statsData } = await res.json()
        setLogs(data || [])
        setStats(statsData)
      }
    } catch (err) {
      console.error('Error loading usage:', err)
    } finally {
      setLoading(false)
    }
  }

  const formatDuration = (ms: number | null) => {
    if (!ms) return '-'
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`
    return date.toLocaleDateString()
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Usage</h1>
        <p className="text-sm text-gray-400 mt-1">
          Monitor your MCP gateway activity
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
              Total Requests
            </p>
            <p className="text-2xl font-bold text-white">
              {stats.total_requests.toLocaleString()}
            </p>
          </div>

          <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
              Success
            </p>
            <p className="text-2xl font-bold text-green-400">
              {stats.success_count.toLocaleString()}
            </p>
          </div>

          <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
              Errors
            </p>
            <p className="text-2xl font-bold text-red-400">
              {stats.error_count.toLocaleString()}
            </p>
          </div>

          <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
              Avg Duration
            </p>
            <p className="text-2xl font-bold text-white">
              {formatDuration(stats.avg_duration_ms)}
            </p>
          </div>

          <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
              Total Tokens
            </p>
            <p className="text-2xl font-bold text-white">
              {stats.total_tokens.toLocaleString()}
            </p>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-2 text-sm rounded-lg transition-all ${
            filter === 'all'
              ? 'bg-white text-black font-medium'
              : 'bg-[#111] text-gray-400 hover:text-white border border-[#1c1c1c]'
          }`}
        >
          All
        </button>
        <button
          onClick={() => setFilter('success')}
          className={`px-4 py-2 text-sm rounded-lg transition-all ${
            filter === 'success'
              ? 'bg-white text-black font-medium'
              : 'bg-[#111] text-gray-400 hover:text-white border border-[#1c1c1c]'
          }`}
        >
          Success
        </button>
        <button
          onClick={() => setFilter('error')}
          className={`px-4 py-2 text-sm rounded-lg transition-all ${
            filter === 'error'
              ? 'bg-white text-black font-medium'
              : 'bg-[#111] text-gray-400 hover:text-white border border-[#1c1c1c]'
          }`}
        >
          Errors
        </button>
      </div>

      {/* Logs Table */}
      {loading ? (
        <div className="text-gray-400 text-sm">Loading...</div>
      ) : logs.length > 0 ? (
        <div className="bg-[#111] border border-[#1c1c1c] rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#0a0a0a] border-b border-[#1c1c1c]">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tool
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Credential
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Duration
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tokens
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Time
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1c1c1c]">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-[#0a0a0a] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="text-sm text-white font-mono">
                          {log.tool_name}
                        </span>
                        <span className="text-xs text-gray-500">
                          {log.service_slug}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300">
                      {log.credential_name}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full ${
                          log.response_status === 'success'
                            ? 'text-green-400 bg-green-500/10 border border-green-500/20'
                            : 'text-red-400 bg-red-500/10 border border-red-500/20'
                        }`}
                      >
                        {log.response_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300 font-mono">
                      {formatDuration(log.duration_ms)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300 font-mono">
                      {log.tokens_used || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">
                      {formatTime(log.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Error messages expandable section could go here */}
        </div>
      ) : (
        <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-12 text-center">
          <div className="text-4xl mb-4">📊</div>
          <h2 className="text-xl font-semibold text-white mb-2">No usage data yet</h2>
          <p className="text-sm text-gray-400">
            Usage logs will appear here once you start making MCP requests.
          </p>
        </div>
      )}
    </div>
  )
}
