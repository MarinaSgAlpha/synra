'use client'

export default function CredentialsPage() {
  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Credentials</h1>
        <p className="text-sm text-gray-400 mt-1">
          Manage your service connections
        </p>
      </div>

      <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-12 text-center">
        <div className="text-4xl mb-4">🔑</div>
        <h2 className="text-xl font-semibold text-white mb-2">No credentials yet</h2>
        <p className="text-sm text-gray-400 mb-6">
          Add your first credential to connect a service to your MCP gateway.
        </p>
        <button className="px-5 py-2.5 bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white text-sm font-medium rounded-md transition-all">
          Add Credential
        </button>
      </div>
    </div>
  )
}
