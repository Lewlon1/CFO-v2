'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatMonth } from '@/lib/constants/dashboard'

type Props = {
  availableMonths: string[]
  selected: string
  onChange: (month: string) => void
}

export function MonthSelector({ availableMonths, selected, onChange }: Props) {
  const idx = availableMonths.indexOf(selected)
  const canPrev = idx < availableMonths.length - 1 // months are DESC
  const canNext = idx > 0

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => canPrev && onChange(availableMonths[idx + 1])}
        disabled={!canPrev}
        className="p-1.5 rounded-md hover:bg-accent disabled:opacity-30 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
        aria-label="Previous month"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <span className="text-lg font-semibold text-foreground min-w-[180px] text-center">
        {formatMonth(selected)}
      </span>
      <button
        onClick={() => canNext && onChange(availableMonths[idx - 1])}
        disabled={!canNext}
        className="p-1.5 rounded-md hover:bg-accent disabled:opacity-30 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
        aria-label="Next month"
      >
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  )
}
