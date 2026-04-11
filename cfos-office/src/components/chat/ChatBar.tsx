'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Send } from 'lucide-react'
import { useChatContext } from './ChatProvider'
import { CFOAvatar } from '@/components/brand/CFOAvatar'
import { QuickActionPills } from './QuickActionPills'
import { useTrackEvent } from '@/lib/events/use-track-event'

export function ChatBar() {
  const { openSheet, messages } = useChatContext()
  const trackEvent = useTrackEvent()
  const pathname = usePathname()
  const isHomePage = pathname === '/office'
  const [isExpanded, setIsExpanded] = useState(isHomePage)
  const wasExpandedRef = useRef(isExpanded)
  const observerRef = useRef<IntersectionObserver | null>(null)

  // Track collapse events
  useEffect(() => {
    if (wasExpandedRef.current && !isExpanded) {
      trackEvent('chat_bar_collapsed', 'engagement')
    }
    wasExpandedRef.current = isExpanded
  }, [isExpanded, trackEvent])

  // IntersectionObserver for scroll detection on home page
  useEffect(() => {
    if (!isHomePage) {
      setIsExpanded(false)
      return
    }

    // Start expanded on home page
    setIsExpanded(true)

    // Watch for the sentinel element
    const checkSentinel = () => {
      const sentinel = document.querySelector('[data-scroll-sentinel]')
      if (!sentinel) {
        // Retry — sentinel may not be rendered yet
        const timer = setTimeout(checkSentinel, 100)
        return () => clearTimeout(timer)
      }

      observerRef.current = new IntersectionObserver(
        ([entry]) => {
          setIsExpanded(entry.isIntersecting)
        },
        { threshold: 0.1 },
      )

      observerRef.current.observe(sentinel)
    }

    checkSentinel()

    return () => {
      observerRef.current?.disconnect()
    }
  }, [isHomePage])

  // Get last assistant message for welcome preview
  const lastAssistantMsg = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant')
  const lastText = lastAssistantMsg?.parts
    ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join(' ') ?? ''
  const previewText = lastText
    ? lastText.slice(0, 80).replace(/\[.*?\]/g, '').trim()
    : 'Ready when you are.'

  return (
    <div
      className="shrink-0 bg-bg-elevated border-t border-border-medium transition-[height,padding] duration-200 ease-out overflow-hidden"
      style={{
        height: isExpanded && isHomePage ? '160px' : '64px',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
      data-chat-bar
    >
      {/* Welcome state (expanded, home only) */}
      {isExpanded && isHomePage && (
        <div className="px-4 pt-3 pb-1 space-y-2">
          {/* Avatar + name row */}
          <div className="flex items-center gap-2.5">
            <CFOAvatar size={42} withOnlineDot />
            <div>
              <span className="text-[15px] font-bold text-text-primary">Your CFO</span>
              <span className="ml-2 text-[10px] text-positive font-data">online</span>
            </div>
          </div>

          {/* Chat bubble with latest message preview */}
          <div className="pl-[52px]">
            <p className="text-[12px] text-text-secondary bg-bg-card border border-border-subtle rounded-[12px_12px_12px_4px] px-3 py-2 line-clamp-1">
              {previewText}
            </p>
          </div>

          {/* Quick action pills */}
          <QuickActionPills />
        </div>
      )}

      {/* Compact input bar (always rendered, visible when collapsed or as bottom row of welcome) */}
      <button
        onClick={openSheet}
        className="flex items-center gap-3 px-4 w-full"
        style={{ height: '64px' }}
        aria-label="Open chat"
      >
        {!isExpanded && <CFOAvatar size={38} />}
        <div className="flex-1 flex items-center h-10 px-3 rounded-[10px] bg-bg-inset border border-border-subtle">
          <span className="text-[13px] text-text-tertiary">Ask your CFO&hellip;</span>
        </div>
        <div className="w-10 h-10 flex items-center justify-center rounded-[10px] bg-accent-gold">
          <Send size={18} className="text-bg-base" />
        </div>
      </button>
    </div>
  )
}
