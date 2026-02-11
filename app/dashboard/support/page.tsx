'use client'

import { useState } from 'react'
import { useDashboard } from '@/contexts/DashboardContext'

export default function SupportPage() {
  const { user } = useDashboard()
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSending(true)

    // Open mailto with pre-filled fields
    const mailtoUrl = `mailto:hello@mcpserver.design?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`From: ${user?.email || 'Unknown'}\n\n${message}`)}`
    window.location.href = mailtoUrl

    // Show confirmation after a brief delay
    setTimeout(() => {
      setSending(false)
      setSent(true)
      setSubject('')
      setMessage('')
      setTimeout(() => setSent(false), 5000)
    }, 500)
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

        {sent && (
          <div className="mb-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
            <p className="text-sm text-green-400">Your email client should have opened with the message. If not, email us directly at hello@mcpserver.design</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
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
            {sending ? 'Opening email...' : 'Send Message'}
          </button>
        </form>
      </div>
    </div>
  )
}
