'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  imported: number
  duplicates: number
  errors: number
  importBatchId: string
  onDone: () => void
  /** True when the user's first Read still stands on declared numbers (no
   *  upgrade Read yet) — the insights CTA then runs the declared→actual
   *  upgrade instead of a plain post-upload compose. */
  declaredPending?: boolean
}

export function ImportResult({ imported, duplicates, errors, importBatchId, onDone, declaredPending }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  // Open a conversation in the chat sheet. `/chat/:id` is a dead route —
  // next.config permanently redirects it to /office and DROPS the id — so the
  // ?chat=open mechanism (read by ChatOpenerTrigger in the office layout,
  // which this page shares) is the working path into the sheet.
  function openConversation(conversationId: string) {
    router.push(`/office?chat=open&conversationId=${conversationId}`)
  }

  async function handleInsightCTA() {
    setLoading(true)
    try {
      if (declaredPending) {
        // Declared-pending: this import is the moment the declared→actual
        // upgrade was built for. The route is idempotent and server-derived
        // (no body); any response carrying a conversationId — the upgraded
        // Read, or a benign decline that still points at the declared
        // conversation — lands the user in the right chat.
        const res = await fetch('/api/insights/upgrade-declared-read', { method: 'POST' })
        const data = await res.json().catch(() => null)
        if (data?.conversationId) {
          openConversation(data.conversationId as string)
          return
        }
        // No conversation to open (unexpected) — fall through to post-upload.
      }
      const res = await fetch('/api/insights/post-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importBatchId, transactionCount: imported }),
      })
      const data = await res.json()
      if (data.conversationId) {
        openConversation(data.conversationId)
        return
      }
      setLoading(false)
    } catch {
      setLoading(false)
    }
  }

  return (
    <div className="text-center space-y-4 py-4">
      <div className="text-4xl">{errors === 0 ? '✅' : '⚠️'}</div>
      <div>
        <p className="font-semibold text-foreground text-lg">Import complete</p>
        <div className="text-sm text-muted-foreground mt-2 space-y-1">
          <p>
            <span className="font-medium text-foreground">{imported}</span> transactions imported
          </p>
          {duplicates > 0 && <p>{duplicates} duplicates skipped</p>}
          {errors > 0 && <p className="text-destructive">{errors} errors</p>}
        </div>
      </div>
      <div className="space-y-2 pt-2">
        <button
          onClick={handleInsightCTA}
          disabled={loading}
          className="w-full rounded-lg bg-primary text-primary-foreground px-6 py-3 text-sm font-medium min-h-[44px] disabled:opacity-60"
        >
          {loading
            ? 'Preparing your insight…'
            : declaredPending
              ? 'Your statements landed — see what they change'
              : 'See what your CFO noticed →'}
        </button>
        <button
          onClick={onDone}
          className="w-full rounded-lg border border-input px-6 py-2 text-sm text-muted-foreground min-h-[44px]"
        >
          View transactions
        </button>
      </div>
    </div>
  )
}
