'use client'

import { useCallback, useRef, useState } from 'react'
import { CfoThinking } from '@/components/brand/CfoThinking'
import { InSheetStatementUpload } from '@/components/upload/InSheetStatementUpload'
import { useChatContext } from './ChatProvider'
import { decideUpgradeAction } from './upgrade-response'

/**
 * Chat-only wrapper around the reusable <InSheetStatementUpload>. Owns the
 * declared-Read *upgrade* logic — the POST to /api/insights/upgrade-declared-read
 * and its loading / error / retry states — so the uploader itself stays generic
 * (onboarding uses the bare uploader with no upgrade behaviour).
 *
 * Flow:
 *   idle      → show the uploader.
 *   composing → on import, show a calm "Reading your statements…" affordance and
 *               POST (no body — the route server-derives everything; compose is
 *               ~20–45s). The surface stays mounted for the whole compose so the
 *               user never sees a blank sheet mid-flight.
 *   on response (decideUpgradeAction maps status+body → action):
 *     load_and_close → loadConversation(id) THEN closeUploadSurface() — close
 *                      only AFTER the POST resolves, so the appended Read is in
 *                      place when the message list reappears beneath the
 *                      declared Read.
 *     close          → closeUploadSurface() — benign decline, no scary error.
 *     notify_close   → closeUploadSurface() + notify() a brief, kind nudge
 *                      (thin upload). The declared Read stays in place.
 *     retry          → error state with "Try again", which re-POSTs the SAME
 *                      route WITHOUT re-uploading (the txns are already imported).
 *
 * Double-tap guard: an inFlight ref mirrors value-map-orchestrator's pattern so
 * the POST can't fire twice concurrently (the server also guards with a 409).
 */
export function UpgradeUploadSurface() {
  const { loadConversation, closeUploadSurface, notify } = useChatContext()

  const [phase, setPhase] = useState<'idle' | 'composing' | 'error'>('idle')
  // Re-entry guard in a ref (not state) so a second fire racing inside the same
  // render cycle still sees the latched value before React batches setPhase.
  const inFlight = useRef(false)

  const runUpgrade = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setPhase('composing')

    try {
      const res = await fetch('/api/insights/upgrade-declared-read', {
        method: 'POST',
      })
      const body = await res.json().catch(() => null)
      const action = decideUpgradeAction(res.status, body)

      switch (action.kind) {
        case 'load_and_close':
          // Load the conversation FIRST so the appended Read is present, then
          // close — the user never sees a blank sheet mid-compose.
          loadConversation(action.conversationId)
          closeUploadSurface()
          return
        case 'notify_close':
          // Ordering contract: close the upload surface BEFORE calling notify().
          // The notice banner only renders in the message-list arm of ChatSheet
          // (it's hidden while the upload surface is open), so these two calls
          // must not be swapped — notify before close would drop the nudge.
          closeUploadSurface()
          notify(action.message)
          return
        case 'close':
          if (action.conversationId) loadConversation(action.conversationId)
          closeUploadSurface()
          return
        case 'retry':
          setPhase('error')
          return
        default: {
          // Exhaustiveness guard: adding a new UpgradeAction variant without a
          // case above becomes a compile error here.
          const _exhaustive: never = action
          return _exhaustive
        }
      }
    } catch (err) {
      // Network/parse failure before we got a verdict — retryable. The upload
      // already landed, so retry re-POSTs without re-uploading.
      console.error('[upgrade-declared-read] request failed', err)
      setPhase('error')
    } finally {
      // Release the guard so the retry button can re-POST. On the success/close
      // paths the surface is already unmounting, so this is a no-op there.
      inFlight.current = false
    }
  }, [loadConversation, closeUploadSurface, notify])

  if (phase === 'composing') {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-4 py-10 flex flex-col items-center text-center gap-3">
          <CfoThinking
            variant="block"
            labels={[
              'Reading your statements…',
              'Finding the patterns…',
              'Sharpening your read…',
            ]}
          />
          <p className="text-sm text-text-secondary leading-snug max-w-xs">
            This takes a little while — I&apos;m reading every line so the picture
            is sharp. Stay with me.
          </p>
        </div>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-4 py-10 flex flex-col items-center text-center gap-4">
          <p className="text-sm text-text-primary leading-snug max-w-xs">
            Something got in the way while I was reading your statements. Your
            upload is safe — let&apos;s try that again.
          </p>
          <div className="flex flex-col gap-2 w-full max-w-xs">
            <button
              type="button"
              onClick={runUpgrade}
              className="inline-flex items-center justify-center px-5 py-3 rounded-xl
                         bg-primary text-primary-foreground text-sm font-semibold
                         hover:opacity-90 transition-opacity min-h-11"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={closeUploadSurface}
              className="inline-flex items-center justify-center px-5 py-3 rounded-xl
                         text-sm font-medium text-text-secondary
                         hover:text-text-primary transition-colors min-h-11"
            >
              Back to chat
            </button>
          </div>
        </div>
      </div>
    )
  }

  // idle — show the reusable uploader. onImported drives the upgrade POST; the
  // uploader stays generic (no upgrade logic leaks into it).
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <InSheetStatementUpload
        onCancel={closeUploadSurface}
        onImported={() => {
          void runUpgrade()
        }}
      />
    </div>
  )
}
