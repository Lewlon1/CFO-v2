'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  imported: number
  duplicates: number
  errors: number
  importBatchId: string
  onDone: () => void
}

export function ImportResult({ imported, duplicates, errors, importBatchId, onDone }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleInsightCTA() {
    setLoading(true)
    try {
      const res = await fetch('/api/insights/post-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importBatchId, transactionCount: imported }),
      })
      const data = await res.json()
      if (data.conversationId) {
        router.push(`/chat/${data.conversationId}`)
      }
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
          {loading ? 'Preparing your insight…' : 'See what your CFO noticed →'}
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
