'use client'

import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/button'

interface Message {
  role: string
  text: string
  challenge?: boolean
  done?: boolean
}

export function InterviewPanel({
  runId,
  messages,
  setMessages,
  onExtracted,
}: {
  runId: string
  messages: Message[]
  setMessages: (updater: (prev: Message[]) => Message[]) => void
  onExtracted: (extracted: Array<{ id: string; value: number; origin: string }>) => void
}) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', text }])
    setBusy(true)
    try {
      const res = await fetch('/api/models/interviewer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, message: text }),
      })
      const data = await res.json()
      onExtracted(data.extracted ?? [])
      const parts = [data.challenge, data.reply].filter(Boolean)
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: parts.join(' ') || 'Noted.', challenge: Boolean(data.challenge), done: Boolean(data.done) },
      ])
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: 'The interviewer dropped the connection — say that again, or fill the value straight into the ledger.' },
      ])
    }
    setBusy(false)
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className="max-w-xs px-3 py-2 text-[13px] leading-relaxed rounded-control border"
              style={
                m.role === 'user'
                  ? { background: 'var(--accent-gold)', color: 'var(--bg-base)', borderColor: 'var(--accent-gold)' }
                  : {
                      background: m.challenge ? 'var(--accent-gold-bg)' : 'var(--bg-card)',
                      borderColor: m.challenge ? 'var(--accent-gold-border)' : 'var(--border-subtle)',
                      color: 'var(--text-primary)',
                    }
              }
            >
              {m.text}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="px-3 py-2 rounded-control border border-border-subtle text-[13px] text-text-tertiary">working…</div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="p-3 border-t border-border-subtle flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder="Answer here, or say “use the default”…"
          className="flex-1"
        />
        <Button onClick={() => void send()} disabled={busy || !input.trim()}>
          Send
        </Button>
      </div>
    </div>
  )
}
