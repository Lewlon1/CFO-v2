'use client'

import { demoAnalytics } from '@/lib/demo/analytics'
import { cn } from '@/lib/utils'

const FACES = [
  { value: 1, emoji: '😐', label: 'Not at all' },
  { value: 2, emoji: '😏', label: 'A little' },
  { value: 3, emoji: '🙂', label: 'Somewhat' },
  { value: 4, emoji: '😮', label: 'Very much' },
  { value: 5, emoji: '🤯', label: 'Spot on' },
]

interface DemoResonanceFeedbackProps {
  value: number | null
  onChange: (rating: number) => void
}

export function DemoResonanceFeedback({ value, onChange }: DemoResonanceFeedbackProps) {
  const handleSelect = (rating: number) => {
    onChange(rating)
    demoAnalytics('demo_resonance_rated', { rating })
  }

  return (
    <div className="w-full max-w-sm flex flex-col items-center gap-3">
      <p className="text-sm font-medium text-foreground text-center">
        How well does this describe you?
      </p>

      <div className="flex items-center gap-3">
        {FACES.map((face) => {
          const isSelected = value === face.value
          return (
            <button
              key={face.value}
              type="button"
              onClick={() => handleSelect(face.value)}
              className={cn(
                'flex flex-col items-center gap-1 rounded-xl p-3 min-w-[44px] min-h-[44px] justify-center transition-all duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'active:scale-95',
                isSelected
                  ? 'bg-[#E8A84C]/15 ring-2 ring-[#E8A84C] scale-110'
                  : value !== null
                    ? 'opacity-40 hover:opacity-70'
                    : 'hover:bg-card/80',
              )}
              aria-label={`${face.label} — ${face.value} out of 5`}
            >
              <span className="text-2xl">{face.emoji}</span>
            </button>
          )
        })}
      </div>

      <div className="flex justify-between w-full max-w-[240px]">
        <span className="text-xs text-muted-foreground">Not really</span>
        <span className="text-xs text-muted-foreground">Spot on</span>
      </div>
    </div>
  )
}
