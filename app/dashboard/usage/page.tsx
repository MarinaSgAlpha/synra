'use client'

export default function UsagePage() {
  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Usage</h1>
        <p className="text-sm text-gray-400 mt-1">
          Monitor your API usage and request logs
        </p>
      </div>

      <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-12 text-center">
        <div className="text-4xl mb-4">📊</div>
        <h2 className="text-xl font-semibold text-white mb-2">No usage data yet</h2>
        <p className="text-sm text-gray-400">
          Usage statistics will appear here once you start making requests through your endpoints.
        </p>
      </div>
    </div>
  )
}
