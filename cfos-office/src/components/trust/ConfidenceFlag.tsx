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
      className="flex items-center gap-1.5 mt-2 text-xs text-office-text-muted hover:text-office-text-secondary transition-colors min-h-[44px]"
    >
      <AlertTriangle size={12} className="text-office-gold shrink-0" />
      <span>
        {count} auto-sorted &mdash; tap to check
      </span>
    </button>
  )
}
