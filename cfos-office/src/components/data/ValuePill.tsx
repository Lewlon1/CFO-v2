'use client'

import { useState, useCallback } from 'react'
import { valueCategories, type ValueCategory } from '@/lib/tokens'

const categoryOrder: ValueCategory[] = ['foundation', 'investment', 'leak', 'burden', 'unsure']

interface ValuePillProps {
  category: ValueCategory
  /** VM-1 honesty gate: false → render the neutral "unmapped" chip instead of
   *  asserting a low-evidence value label. Tapping still cycles + corrects. */
  displayable?: boolean
  onChange?: (newCategory: ValueCategory) => void
}

export function ValuePill({ category: initialCategory, displayable = true, onChange }: ValuePillProps) {
  // Non-displayable labels start the cycle from 'unsure' so the first tap
  // lands on 'foundation' rather than revealing the suppressed guess.
  const [category, setCategory] = useState<ValueCategory>(
    displayable ? initialCategory : 'unsure'
  )
  const [touched, setTouched] = useState(false)

  const cycle = useCallback(() => {
    const idx = categoryOrder.indexOf(category)
    const next = categoryOrder[(idx + 1) % categoryOrder.length]
    setCategory(next)
    setTouched(true)
    onChange?.(next)
  }, [category, onChange])

  const showUnmapped = !displayable && !touched
  const cat = valueCategories[category] ?? valueCategories.unsure

  return (
    <button
      onClick={cycle}
      aria-label={
        showUnmapped ? 'Unmapped — tap to tell C. once.' : `Value: ${cat.label}. Tap to change.`
      }
      className="font-data text-[8px] px-2 py-[3px] rounded tracking-[0.03em] cursor-pointer mt-[3px] active:opacity-80 transition-opacity"
      style={
        showUnmapped
          ? {
              backgroundColor: 'var(--muted)',
              color: 'var(--text-tertiary)',
              border: 'none',
            }
          : {
              backgroundColor: cat.bg,
              color: cat.color,
              border: 'border' in cat ? cat.border : 'none',
            }
      }
    >
      {/* VM-3 (VM-1 follow-up): the unmapped chip carries the invite — one
          tap starts the correction cycle, i.e. telling C. once. */}
      {showUnmapped ? 'unmapped — tap to tell C. once' : cat.label}
    </button>
  )
}
