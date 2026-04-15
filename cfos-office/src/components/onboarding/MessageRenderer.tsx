'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { CFOAvatar } from '@/components/brand/CFOAvatar'
import { TypingIndicator } from './TypingIndicator'
import { CategoryDisplay } from './CategoryDisplay'
import type { BeatMessage, OnboardingData } from '@/lib/onboarding/types'

interface MessageRendererProps {
  messages: BeatMessage[]
  messageIndex: number
  data: OnboardingData
  onMessageRevealed: () => void
  onAction: (action: string) => void
  archetypeSlot?: React.ReactNode
  insightSlot?: React.ReactNode
}

function interpolate(text: string, data: OnboardingData): string {
  return text
    .replace(/\{name\}/g, data.name || 'there')
    .replace(/\{tx_count\}/g, String(data.transactionCount ?? 0))
}

function isSpecialToken(text: string | undefined): string | null {
  if (!text) return null
  if (text === 'CATEGORY_DISPLAY') return 'category'
  if (text === 'ARCHETYPE_DISPLAY') return 'archetype'
  if (text === 'INSIGHT_DISPLAY') return 'insight'
  return null
}

function MessageBubble({ text, data }: { text: string; data: OnboardingData }) {
  const html = interpolate(text, data)
  return (
    <div className="flex items-start gap-3 px-4 py-1.5 animate-[fade-in_0.3s_ease-out]">
      <CFOAvatar size={28} className="mt-0.5" />
      <div
        className="text-sm text-[var(--text-primary)] leading-relaxed max-w-[85%] font-[var(--font-dm-sans)]"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

function ActionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="flex px-4 py-2 animate-[fade-in_0.3s_ease-out]">
      <div className="ml-[40px]">
        <button
          onClick={onClick}
          className="px-5 py-2.5 rounded-lg bg-[var(--accent-gold)] text-[#0F0F0D] text-sm font-semibold
                     hover:brightness-110 active:scale-[0.98] transition-all min-h-[44px]"
        >
          {label}
        </button>
      </div>
    </div>
  )
}

export function MessageRenderer({
  messages,
  messageIndex,
  data,
  onMessageRevealed,
  onAction,
  archetypeSlot,
  insightSlot,
}: MessageRendererProps) {
  const [revealedUpTo, setRevealedUpTo] = useState(-1)
  const [isTyping, setIsTyping] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

  // When messageIndex advances, start typing indicator then reveal
  useEffect(() => {
    if (messageIndex < 0 || messageIndex <= revealedUpTo) return

    const msg = messages[messageIndex]
    if (!msg) return

    if (msg.delayMs > 0) {
      setIsTyping(true)
      timerRef.current = setTimeout(() => {
        setIsTyping(false)
        setRevealedUpTo(messageIndex)
        onMessageRevealed()
      }, msg.delayMs)
    } else {
      setRevealedUpTo(messageIndex)
      onMessageRevealed()
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageIndex])

  // Auto-scroll on new content
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [revealedUpTo, isTyping])

  const handleAction = useCallback((action: string) => {
    onAction(action)
  }, [onAction])

  return (
    <div className="flex flex-col gap-1">
      {messages.slice(0, revealedUpTo + 1).map((msg) => {
        // Action buttons (continue, handoff, etc.)
        if (msg.action && msg.buttonText) {
          return (
            <ActionButton
              key={msg.id}
              label={msg.buttonText}
              onClick={() => handleAction(msg.action!)}
            />
          )
        }

        // Action embeds (no text, no button — handled by parent)
        if (msg.action && !msg.text) {
          return <div key={msg.id} data-action={msg.action} />
        }

        // Special tokens
        const token = isSpecialToken(msg.text)
        if (token === 'category') {
          return (
            <div key={msg.id} className="px-4 py-2 ml-[40px] animate-[fade-in_0.3s_ease-out]">
              <CategoryDisplay />
            </div>
          )
        }
        if (token === 'archetype') {
          return <React.Fragment key={msg.id}>{archetypeSlot ?? null}</React.Fragment>
        }
        if (token === 'insight') {
          return <React.Fragment key={msg.id}>{insightSlot ?? null}</React.Fragment>
        }

        // Regular text message
        if (msg.text) {
          return <MessageBubble key={msg.id} text={msg.text} data={data} />
        }

        return null
      })}

      {isTyping && <TypingIndicator />}

      <div ref={scrollRef} />
    </div>
  )
}
