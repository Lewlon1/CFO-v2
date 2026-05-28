'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { advanceStep } from '@/app/onboarding-v2/actions-step'
import { useTrackEvent } from '@/lib/events/use-track-event'

type Props = {
  displayName: string | null
  entryStruggle: string | null
}

/**
 * Session 32 (B) — terminal screen for users in the layered-read flow.
 *
 * Pattern mirrors ArchetypeOrchestrator (parallel surface). On mount:
 *   1. POST /api/insights/post-upload — idempotent, runs the layered
 *      composition if not already done and returns { conversationId }.
 *   2. GET /api/conversations/recent?id=… — fetches the pre-composed
 *      assistant message that was inserted alongside the conversation.
 *   3. Stamp onboarding_step → 'first_read_shown' so a refresh keeps the
 *      user on this surface (resumeRoute reads this state).
 *
 * On "Continue the conversation" click: stamp 'complete' and navigate to
 * /office?chat=open&conversationId=… so the chat sheet opens with the
 * conversation already loaded.
 */
export function FirstReadOrchestrator({ entryStruggle }: Props) {
  const router = useRouter()
  const trackEvent = useTrackEvent()
  const [composedMessage, setComposedMessage] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const requestedRef = useRef(false)
  const stampedShownRef = useRef(false)

  useEffect(() => {
    if (requestedRef.current) return
    requestedRef.current = true

    let cancelled = false
    void (async () => {
      try {
        const postRes = await fetch('/api/insights/post-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
        if (!postRes.ok) {
          throw new Error(`post-upload returned ${postRes.status}`)
        }
        const postData = await postRes.json()
        const newConversationId = postData?.conversationId as string | null
        if (!newConversationId) throw new Error('post-upload returned no conversationId')
        if (cancelled) return
        setConversationId(newConversationId)

        const msgRes = await fetch(`/api/conversations/recent?id=${newConversationId}`)
        if (!msgRes.ok) throw new Error(`conversations/recent returned ${msgRes.status}`)
        const msgData = await msgRes.json()
        const firstAssistant = (msgData?.messages ?? []).find(
          (m: { role?: string; content?: string }) => m.role === 'assistant' && m.content,
        )
        if (cancelled) return

        if (firstAssistant?.content) {
          setComposedMessage(String(firstAssistant.content))
        } else {
          setError('Your first read is still being prepared — give it a moment and refresh.')
        }
      } catch (err) {
        console.error('[onboarding-v2.first-read] fetch failed', err)
        if (!cancelled) setError('Something went wrong loading your first read.')
      } finally {
        if (!cancelled) setLoading(false)
        if (!stampedShownRef.current && !cancelled) {
          stampedShownRef.current = true
          void advanceStep('first_read_shown').catch((stepErr) => {
            console.error('[onboarding-v2.first-read] advanceStep failed', stepErr)
          })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  function handleContinue() {
    if (pending) return
    setError(null)
    startTransition(async () => {
      try {
        trackEvent('onboarding_v2.first_read_continue', {
          entry_struggle: entryStruggle ?? null,
          had_message: Boolean(composedMessage),
        })
        await advanceStep('complete')

        const destination = conversationId
          ? `/office?chat=open&conversationId=${conversationId}`
          : '/office?chat=open'
        router.push(destination)
      } catch (err) {
        console.error('[onboarding-v2.first-read] continue failed', err)
        setError('Something went wrong. Please try again.')
      }
    })
  }

  return (
    <main className="min-h-dvh flex flex-col bg-background">
      <div className="flex-1 flex flex-col max-w-[430px] mx-auto w-full px-4 py-6">
        <p className="eyebrow mb-6 text-center">YOUR FIRST READ</p>

        <div className="flex-1">
          {loading ? (
            <FirstReadSkeleton />
          ) : composedMessage ? (
            <article
              className="whitespace-pre-wrap text-[15px] leading-[1.65] text-foreground"
              style={{ fontFamily: 'var(--font-cormorant), serif' }}
            >
              {composedMessage}
            </article>
          ) : (
            <p className="text-sm text-muted-foreground">
              Your CFO is still warming up. Refresh in a moment.
            </p>
          )}
        </div>

        {error && (
          <p className="text-center mt-6 text-sm text-destructive">{error}</p>
        )}

        <button
          type="button"
          onClick={handleContinue}
          disabled={loading || pending}
          className={
            'w-full mt-6 transition-opacity min-h-12 rounded-xl font-sans text-[15px] font-medium ' +
            (loading || pending
              ? 'bg-muted text-muted-foreground cursor-not-allowed'
              : 'bg-foreground text-background cursor-pointer')
          }
        >
          {pending ? 'Opening your office…' : 'Continue the conversation →'}
        </button>
        <p className="text-xs text-muted-foreground text-center mt-3">
          Ask the CFO anything. It already has the context.
        </p>

        {!loading && composedMessage && (
          <div className="mt-6 pt-5 border-t border-border/60">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              Optional · 2 minutes
            </p>
            <button
              type="button"
              onClick={() => {
                trackEvent('onboarding_v2.first_read_value_map_optin', {
                  entry_struggle: entryStruggle ?? null,
                })
                router.push('/onboarding-v2/value-map')
              }}
              className="text-left text-[14px] text-foreground underline underline-offset-2 hover:opacity-80"
            >
              Want to deepen this with a quick exercise on what you actually value?
            </button>
          </div>
        )}
      </div>
    </main>
  )
}

const FLASH_LINES = [
  'Reading your last 90 days.',
  'Looking for patterns.',
  'Where habits and intent diverge.',
  'Drafting your read.',
] as const

function FirstReadSkeleton() {
  const [revealed, setRevealed] = useState(1)
  useEffect(() => {
    const intervals: ReturnType<typeof setTimeout>[] = []
    for (let i = 2; i <= FLASH_LINES.length; i++) {
      intervals.push(setTimeout(() => setRevealed(i), (i - 1) * 900))
    }
    return () => intervals.forEach(clearTimeout)
  }, [])

  return (
    <ul className="space-y-3 font-sans text-[14px] text-muted-foreground">
      {FLASH_LINES.slice(0, revealed).map((line, idx) => (
        <li
          key={line}
          className={
            'flex items-baseline gap-2 transition-opacity duration-500 ' +
            (idx === revealed - 1 ? 'opacity-100' : 'opacity-60')
          }
        >
          <span className="text-accent-gold">·</span>
          <span>{line}</span>
        </li>
      ))}
    </ul>
  )
}
