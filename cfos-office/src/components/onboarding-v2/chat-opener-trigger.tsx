'use client'

import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useChatContext } from '@/components/chat/ChatProvider'
import { useTrackEvent } from '@/lib/events/use-track-event'

export function ChatOpenerTrigger() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { openSheet, loadConversation } = useChatContext()
  const trackEvent = useTrackEvent()
  const handledRef = useRef(false)

  useEffect(() => {
    if (handledRef.current) return
    if (searchParams.get('chat') !== 'open') return
    const conversationId = searchParams.get('conversationId')
    if (!conversationId) return
    handledRef.current = true

    const isFreeTextOpener = searchParams.get('fto') === '1'

    openSheet()
    loadConversation(conversationId)

    if (isFreeTextOpener) {
      fetch('/api/onboarding-v2/free-text-opener', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId }),
      })
        .then(async (r) => {
          if (!r.ok) return
          await r.json()
          trackEvent('onboarding_v2.chat_opener_delivered', {
            route: 'free_text',
          })
          // Reload conversation messages so the new assistant turn appears
          loadConversation(conversationId)
        })
        .catch((err) => {
          console.error('[ChatOpenerTrigger] free-text opener failed', err)
        })
    }

    // Strip the params from the URL once handled
    const url = new URL(window.location.href)
    url.searchParams.delete('chat')
    url.searchParams.delete('conversationId')
    url.searchParams.delete('fto')
    const remainingSearch = url.searchParams.toString()
    router.replace(url.pathname + (remainingSearch ? `?${remainingSearch}` : ''))
  }, [searchParams, openSheet, loadConversation, router, trackEvent])

  return null
}
