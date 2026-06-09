'use client'

import { useEffect, useRef, useState } from 'react'
import { trackEvent } from '@/lib/mixpanel'

type ChatMessage = { role: 'user' | 'assistant'; content: string }

const TOPIC_RE = /\n?\[TOPIC:\s*([a-z\-]+)\]\s*$/i

function extractTopic(text: string): { clean: string; topic: string | null } {
  const m = text.match(TOPIC_RE)
  if (!m) return { clean: text.trim(), topic: null }
  return { clean: text.replace(TOPIC_RE, '').trim(), topic: m[1].toLowerCase() }
}

// ── Minimal markdown renderer (code blocks, inline code, bold, links, lists, line breaks) ──

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderInline(text: string): string {
  let out = escapeHtml(text)
  // inline code
  out = out.replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 bg-[#1c1c1c] rounded text-[12px] font-mono text-blue-300">$1</code>')
  // bold
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong class="text-white">$1</strong>')
  // links [text](url)
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300 underline">$1</a>'
  )
  return out
}

function MarkdownText({ content }: { content: string }) {
  const blocks: { type: 'p' | 'pre' | 'ul' | 'ol'; html: string }[] = []
  const lines = content.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const fenceLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        fenceLines.push(lines[i])
        i++
      }
      i++ // closing fence
      blocks.push({
        type: 'pre',
        html: `<pre class="bg-[#0a0a0a] border border-[#1c1c1c] rounded-md p-3 overflow-x-auto"><code class="font-mono text-[12px] text-blue-200 whitespace-pre">${escapeHtml(
          fenceLines.join('\n')
        )}</code></pre>`,
      })
      continue
    }

    // bullet list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i++
      }
      blocks.push({
        type: 'ul',
        html: `<ul class="list-disc pl-5 space-y-1">${items.map((it) => `<li>${renderInline(it)}</li>`).join('')}</ul>`,
      })
      continue
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      blocks.push({
        type: 'ol',
        html: `<ol class="list-decimal pl-5 space-y-1">${items.map((it) => `<li>${renderInline(it)}</li>`).join('')}</ol>`,
      })
      continue
    }

    // paragraph (collect until blank line or special line)
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('```') &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i])
      i++
    }
    if (para.length > 0) {
      blocks.push({ type: 'p', html: `<p>${renderInline(para.join(' '))}</p>` })
    }
    i++ // skip blank
  }

  return (
    <div
      className="space-y-2 text-[13px] leading-relaxed"
      dangerouslySetInnerHTML={{ __html: blocks.map((b) => b.html).join('') }}
    />
  )
}

// ── Component ────────────────────────────────────────────────────

export function SupportChat() {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [usedToday, setUsedToday] = useState<number | null>(null)
  const [limitReached, setLimitReached] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const openedTracked = useRef(false)

  const DAILY_LIMIT = 20
  const messagesRemaining =
    usedToday !== null ? Math.max(0, DAILY_LIMIT - usedToday) : DAILY_LIMIT

  useEffect(() => {
    if (!isOpen) return
    if (!openedTracked.current) {
      trackEvent('support_chat_opened')
      openedTracked.current = true
    }
  }, [isOpen])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, sending])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || sending || limitReached) return

    const userMsg: ChatMessage = { role: 'user', content: text }
    const history = [...messages]
    const nextMessages = [...history, userMsg]

    setMessages(nextMessages)
    setInput('')
    setSending(true)
    setError(null)

    trackEvent('support_chat_message_sent', {
      message_preview: text.slice(0, 50),
      message_number: nextMessages.filter((m) => m.role === 'user').length,
    })

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, conversationHistory: history }),
      })
      const data = await res.json()

      if (!res.ok) {
        if (res.status === 429) {
          setLimitReached(true)
          setUsedToday(DAILY_LIMIT)
        }
        setError(data.error || 'Something went wrong.')
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.error || 'Sorry — please try again.' },
        ])
        return
      }

      if (typeof data.used_today === 'number') setUsedToday(data.used_today)

      const { clean, topic } = extractTopic(data.reply || '')
      if (topic) {
        trackEvent('support_chat_topic_detected', { topic })
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: clean }])
    } catch (err: any) {
      setError('Network error — please try again.')
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Network error — please try again.' },
      ])
    } finally {
      setSending(false)
    }
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <>
      {/* Floating button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          aria-label="Open support chat"
          className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white shadow-lg shadow-blue-500/30 flex items-center justify-center transition-all hover:scale-105"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 12h.01M12 12h.01M16 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </button>
      )}

      {/* Panel */}
      {isOpen && (
        <div className="fixed inset-x-0 bottom-0 z-40 sm:inset-auto sm:bottom-6 sm:right-6 sm:w-[380px] sm:h-[500px] flex flex-col bg-[#0d0d0d] border border-[#1c1c1c] rounded-t-lg sm:rounded-lg shadow-2xl h-[80vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#1c1c1c]">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400" />
              <h3 className="text-sm font-semibold text-white">Synra Support</h3>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              aria-label="Close support chat"
              className="text-gray-400 hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center pt-6">
                <p className="text-sm text-gray-400 mb-2">Hi! 👋</p>
                <p className="text-xs text-gray-500 max-w-[260px] mx-auto leading-relaxed">
                  Ask me about connecting your database, billing, or troubleshooting.
                </p>
              </div>
            )}

            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-lg text-[13px] leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-blue-500 text-white'
                      : 'bg-[#161616] border border-[#1c1c1c] text-gray-200'
                  }`}
                >
                  {m.role === 'user' ? (
                    <div className="whitespace-pre-wrap break-words">{m.content}</div>
                  ) : (
                    <MarkdownText content={m.content} />
                  )}
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex justify-start">
                <div className="bg-[#161616] border border-[#1c1c1c] px-3 py-2 rounded-lg">
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '120ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '240ms' }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-[#1c1c1c] p-3 space-y-2">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                disabled={sending || limitReached}
                rows={1}
                placeholder={limitReached ? 'Daily limit reached' : 'Ask a question…'}
                className="flex-1 resize-none px-3 py-2 bg-[#0a0a0a] border border-[#1c1c1c] rounded-md text-white text-sm placeholder-gray-600 focus:border-blue-500 focus:outline-none max-h-24 disabled:opacity-50"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || sending || limitReached}
                className="px-3 py-2 bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-gray-700 disabled:to-gray-800 disabled:cursor-not-allowed text-white text-sm rounded-md transition-all"
                aria-label="Send"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
            <div className="flex items-center justify-between text-[10px] text-gray-500">
              <span>
                {usedToday !== null
                  ? `${usedToday}/${DAILY_LIMIT} messages today`
                  : `${DAILY_LIMIT} messages/day`}
              </span>
              {error && !limitReached && <span className="text-red-400 truncate">{error}</span>}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
