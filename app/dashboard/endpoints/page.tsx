'use client'

export default function EndpointsPage() {
  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Endpoints</h1>
        <p className="text-sm text-gray-400 mt-1">
          Your MCP gateway endpoints
        </p>
      </div>

      <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-12 text-center">
        <div className="text-4xl mb-4">🔗</div>
        <h2 className="text-xl font-semibold text-white mb-2">No endpoints yet</h2>
        <p className="text-sm text-gray-400">
          Endpoints are automatically created when you add credentials.
        </p>
      </div>
    </div>
  )
}
