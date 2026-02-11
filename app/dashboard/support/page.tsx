'use client'

import { useState } from 'react'
import { useDashboard } from '@/contexts/DashboardContext'

export default function SupportPage() {
  const { user } = useDashboard()
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSending(true)
    setError(null)

    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, message }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to send message')
      }

      setSent(true)
      setSubject('')
      setMessage('')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Support</h1>
        <p className="text-sm text-gray-400 mt-1">
          Need help? We&apos;re here for you.
        </p>
      </div>

      {/* Direct contact */}
      <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h2 className="text-white font-medium">Email us directly</h2>
            <a
              href="mailto:hello@mcpserver.design"
              className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              hello@mcpserver.design
            </a>
          </div>
        </div>
        <p className="text-sm text-gray-400">
          We typically respond within 24 hours.
        </p>
      </div>

      {/* Contact form */}
      <div className="bg-[#111] border border-[#1c1c1c] rounded-lg p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Send a message</h2>

        {sent ? (
          <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
            <p className="text-sm text-green-400 font-medium mb-1">Message sent!</p>
            <p className="text-sm text-gray-400">We&apos;ll get back to you at {user?.email} as soon as possible.</p>
            <button
              onClick={() => setSent(false)}
              className="mt-3 text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              Send another message
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <div>
              <label className="block text-sm text-gray-300 mb-1">Your Email</label>
              <input
                type="email"
                value={user?.email || ''}
                disabled
                className="w-full px-4 py-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md text-gray-400 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-1">Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
                placeholder="What do you need help with?"
                className="w-full px-4 py-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md text-white text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-1">Message</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                rows={5}
                placeholder="Describe your issue or question..."
                className="w-full px-4 py-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md text-white text-sm focus:border-blue-500 focus:outline-none resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={sending}
              className="px-5 py-2.5 text-sm bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-gray-600 disabled:to-gray-700 text-white font-medium rounded-md transition-all"
            >
              {sending ? 'Sending...' : 'Send Message'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
