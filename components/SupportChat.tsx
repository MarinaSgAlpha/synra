'use client'

import { useEffect, useRef, useState } from 'react'
import { trackEvent } from '@/lib/mixpanel'

type ChatMessage = { role: 'user' | 'assistant'; content: string }

const OPEN_AGENT_EVENT = 'synra:open-agent'

/**
 * Opens the Synra Agent from anywhere in the app. Optionally pre-fills the
 * input with a contextual prompt so the user just hits send.
 */
export function openAgent(prefill?: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(OPEN_AGENT_EVENT, { detail: { prefill } })
  )
}

const SUGGESTIONS = [
  'How do I connect my Postgres?',
  'Set up Claude Desktop',
  'Restrict which tables AI sees',
  'Upgrade my plan',
  'Fix a failed connection',
]

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
    const handleOpen = (e: Event) => {
      setIsOpen(true)
      const prefill = (e as CustomEvent<{ prefill?: string }>).detail?.prefill
      if (prefill) {
        setInput((current) => (current.trim() ? current : prefill))
      }
    }
    window.addEventListener(OPEN_AGENT_EVENT, handleOpen)
    return () => window.removeEventListener(OPEN_AGENT_EVENT, handleOpen)
  }, [])

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
      {/* Floating button — "Agent" pill */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          aria-label="Open AI Agent"
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#0d0d0d] border border-purple-500/40 hover:border-purple-400/70 text-white text-sm font-medium shadow-lg shadow-purple-500/20 transition-all hover:scale-[1.02]"
        >
          <svg className="w-4 h-4 text-purple-300" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 4v-4z" />
          </svg>
          <span>Agent</span>
        </button>
      )}

      {/* Panel */}
      {isOpen && (
        <div className="fixed inset-x-0 bottom-0 z-40 sm:inset-auto sm:bottom-6 sm:right-6 sm:w-[400px] sm:h-[560px] flex flex-col bg-[#0a0a0a] border border-purple-500/30 rounded-t-xl sm:rounded-xl shadow-2xl shadow-purple-500/10 h-[85vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#1c1c1c]">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-gradient-to-br from-purple-500/30 to-blue-500/30 border border-purple-500/40 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-purple-300" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-white">Synra Agent</h3>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 border border-purple-500/30 text-purple-300 font-medium">
                BETA
              </span>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  onClick={() => {
                    setMessages([])
                    setError(null)
                    openedTracked.current = false
                  }}
                  aria-label="Reset conversation"
                  className="p-1 text-gray-500 hover:text-white transition-colors"
                  title="New conversation"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                aria-label="Close"
                className="p-1 text-gray-400 hover:text-white transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="pt-2">
                <h4 className="text-base font-semibold text-white mb-1">New Agent</h4>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Connect databases, configure your endpoint, debug connections, manage billing.
                </p>
              </div>
            )}

            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[88%] px-3 py-2 rounded-lg text-[13px] leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-purple-500/15 border border-purple-500/30 text-white'
                      : 'bg-[#111] border border-[#1c1c1c] text-gray-200'
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
                <div className="bg-[#111] border border-[#1c1c1c] px-3 py-2 rounded-lg">
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-300 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-300 animate-bounce" style={{ animationDelay: '120ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-300 animate-bounce" style={{ animationDelay: '240ms' }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Suggestions (only on empty state) */}
          {messages.length === 0 && !limitReached && (
            <div className="px-3 pb-2 flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="px-2.5 py-1 text-[11px] text-gray-300 bg-[#111] hover:bg-[#181818] border border-[#1c1c1c] hover:border-purple-500/30 rounded-full transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="p-3">
            <div
              className={`relative flex items-end gap-2 bg-[#0d0d0d] border rounded-lg transition-colors ${
                limitReached ? 'border-[#1c1c1c]' : 'border-purple-500/30 focus-within:border-purple-400/60'
              }`}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                disabled={sending || limitReached}
                rows={1}
                placeholder={limitReached ? 'Daily limit reached' : 'Develop, debug, deploy anything…'}
                className="flex-1 resize-none px-3 py-2.5 bg-transparent text-white text-sm placeholder-gray-600 focus:outline-none max-h-28 disabled:opacity-50"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || sending || limitReached}
                className="m-1.5 w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-md bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 disabled:bg-transparent disabled:border-[#1c1c1c] disabled:cursor-not-allowed text-purple-300 disabled:text-gray-600 transition-all"
                aria-label="Send"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </div>
            <div className="flex items-center justify-between mt-2 px-1 text-[10px] text-gray-600">
              <span>
                {usedToday !== null
                  ? `${usedToday}/${DAILY_LIMIT} messages today`
                  : `${DAILY_LIMIT} messages/day · Claude Haiku`}
              </span>
              {error && !limitReached && <span className="text-red-400 truncate ml-2">{error}</span>}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
