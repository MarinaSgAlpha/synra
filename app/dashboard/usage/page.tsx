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

type SortKey =
  | 'tool_name'
  | 'credential_name'
  | 'response_status'
  | 'duration_ms'
  | 'tokens_used'
  | 'created_at'

type SortDir = 'asc' | 'desc'

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'tool_name', label: 'Tool' },
  { key: 'credential_name', label: 'Credential' },
  { key: 'response_status', label: 'Status' },
  { key: 'duration_ms', label: 'Duration' },
  { key: 'tokens_used', label: 'Tokens' },
  { key: 'created_at', label: 'Time' },
]

function compareLogs(a: UsageLog, b: UsageLog, key: SortKey): number {
  switch (key) {
    case 'tool_name':
      return a.tool_name.localeCompare(b.tool_name)
    case 'credential_name':
      return a.credential_name.localeCompare(b.credential_name)
    case 'response_status':
      return a.response_status.localeCompare(b.response_status)
    case 'duration_ms':
      return (a.duration_ms ?? -1) - (b.duration_ms ?? -1)
    case 'tokens_used':
      return (a.tokens_used ?? -1) - (b.tokens_used ?? -1)
    case 'created_at':
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    default:
      return 0
  }
}

export default function UsagePage() {
  const [logs, setLogs] = useState<UsageLog[]>([])
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'success' | 'error'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('created_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

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

  const sortedLogs = [...logs].sort((a, b) => {
    const cmp = compareLogs(a, b, sortKey)
    return sortDir === 'asc' ? cmp : -cmp
  })

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    // Newest / largest first feels natural for time and numbers
    setSortDir(key === 'tool_name' || key === 'credential_name' || key === 'response_status' ? 'asc' : 'desc')
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
                  {SORT_COLUMNS.map(({ key, label }) => {
                    const active = sortKey === key
                    return (
                      <th
                        key={key}
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        <button
                          type="button"
                          onClick={() => handleSort(key)}
                          className={`inline-flex items-center gap-1 transition-colors ${
                            active ? 'text-white' : 'text-gray-500 hover:text-gray-300'
                          }`}
                        >
                          {label}
                          <span className="font-mono text-[10px] opacity-80" aria-hidden>
                            {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                          </span>
                        </button>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1c1c1c]">
                {sortedLogs.map((log) => (
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
