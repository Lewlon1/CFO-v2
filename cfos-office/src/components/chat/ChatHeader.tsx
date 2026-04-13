'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useChatContext } from './ChatProvider'
import { CFOAvatar } from '@/components/brand/CFOAvatar'
import { QuickActionPills } from './QuickActionPills'
import { useTrackEvent } from '@/lib/events/use-track-event'
import { getGreeting, formatHeaderDate } from '@/lib/utils'

interface ChatHeaderProps {
  initial: string
}

export function ChatHeader({ initial }: ChatHeaderProps) {
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
      trackEvent('chat_header_collapsed', 'engagement')
    }
    wasExpandedRef.current = isExpanded
  }, [isExpanded, trackEvent])

  // IntersectionObserver for scroll detection on home page
  useEffect(() => {
    if (!isHomePage) {
      setIsExpanded(false)
      return
    }

    setIsExpanded(true)

    const checkSentinel = () => {
      const sentinel = document.querySelector('[data-scroll-sentinel]')
      if (!sentinel) {
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

  // Get last assistant message for preview
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
    <header
      className="shrink-0 bg-[#0F0F0D] transition-[height] duration-200 ease-out overflow-hidden"
      style={{
        height: isExpanded && isHomePage ? '180px' : '60px',
        paddingTop: 'env(safe-area-inset-top)',
      }}
    >
      {isExpanded && isHomePage ? (
        <>
          {/* Full HeaderBar layout */}
          <div className="flex items-center gap-3 px-4 pt-4 pb-1.5">
            <CFOAvatar size={48} withOnlineDot />

            <div className="flex-1 min-w-0">
              <div>
                <span className="font-data text-[9px] text-text-muted tracking-[0.04em]">
                  THE{' '}
                </span>
                <span className="font-[var(--font-cormorant)] text-[18px] text-text-secondary font-semibold leading-none">
                  CFO&apos;s Office
                </span>
              </div>
              <div className="text-[15px] font-bold mt-[3px]">
                {getGreeting()},{' '}
                <span className="text-accent-gold">{initial}</span>
              </div>
            </div>

            <div className="text-right shrink-0">
              <div className="font-data text-[11px] text-[rgba(245,245,240,0.4)]">
                {formatHeaderDate()}
              </div>
            </div>

            <div
              className="shrink-0 rounded-full flex items-center justify-center"
              style={{
                width: 32,
                height: 32,
                backgroundColor: 'rgba(232,168,76,0.1)',
                border: '1px solid rgba(232,168,76,0.18)',
                fontSize: 12,
                fontWeight: 700,
                color: '#E8A84C',
              }}
            >
              {initial}
            </div>
          </div>

          {/* ChatBar row */}
          <div
            className="px-4 pt-1 pb-2 cursor-pointer"
            onClick={openSheet}
          >
            <div
              className="flex items-center gap-2 rounded-[10px] px-3 h-10 active:border-[rgba(232,168,76,0.3)] transition-colors"
              style={{
                backgroundColor: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <span className="text-[13px] text-[rgba(245,245,240,0.2)] flex-1">
                Ask your CFO&hellip;
              </span>
              <div
                className="shrink-0 rounded-full flex items-center justify-center"
                style={{
                  width: 28,
                  height: 28,
                  backgroundColor: 'rgba(232,168,76,0.15)',
                }}
              >
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 19V5M5 12l7-7 7 7"
                    stroke="#E8A84C"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div
            className="mx-4"
            style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.04)' }}
          />

          {/* Quick action pills */}
          <div className="px-4 pt-2 pb-1">
            <QuickActionPills />
          </div>
        </>
      ) : (
        /* Compact: avatar + input pill + user badge */
        <div className="flex items-center gap-2.5 px-4 h-[60px]">
          <CFOAvatar size={30} withOnlineDot />

          <button
            onClick={openSheet}
            className="flex-1 flex items-center gap-2 h-10 px-3 rounded-[10px] transition-colors"
            style={{
              backgroundColor: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
            aria-label="Open chat"
          >
            <span className="text-[13px] text-[rgba(245,245,240,0.2)] flex-1">Ask your CFO&hellip;</span>
            <div
              className="shrink-0 rounded-full flex items-center justify-center"
              style={{
                width: 28,
                height: 28,
                backgroundColor: 'rgba(232,168,76,0.15)',
              }}
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 19V5M5 12l7-7 7 7"
                  stroke="#E8A84C"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </button>

          <div
            className="shrink-0 rounded-full flex items-center justify-center"
            style={{
              width: 32,
              height: 32,
              backgroundColor: 'rgba(232,168,76,0.1)',
              border: '1px solid rgba(232,168,76,0.18)',
              fontSize: 12,
              fontWeight: 700,
              color: '#E8A84C',
            }}
          >
            {initial}
          </div>
        </div>
      )}
    </header>
  )
}
