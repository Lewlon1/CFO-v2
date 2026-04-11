'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'

export function ConfidenceFlag() {
  const router = useRouter()
  const [count, setCount] = useState(0)

  useEffect(() => {
    fetch('/api/transactions/low-confidence-count')
      .then((r) => (r.ok ? r.json() : { count: 0 }))
      .then((data) => setCount(data.count ?? 0))
      .catch(() => {})
  }, [])

  if (count === 0) return null

  return (
    <button
      onClick={() =>
        router.push('/office/cash-flow/transactions?confidence=low')
      }
      className="flex items-center gap-1.5 mt-2 font-data text-[8px] text-accent-gold-soft border border-dashed border-accent-gold-border rounded-[8px] px-2.5 py-1.5 hover:bg-accent-gold-bg transition-colors min-h-[44px]"
    >
      <span className="shrink-0">~</span>
      <span>
        {count} auto-sorted &mdash; tap to check
      </span>
    </button>
  )
}
