'use client'

import { useState, useCallback } from 'react'
import { valueCategories, type ValueCategory } from '@/lib/tokens'

const categoryOrder: ValueCategory[] = ['foundation', 'investment', 'leak', 'burden', 'unsure']

interface ValuePillProps {
  category: ValueCategory
  onChange?: (newCategory: ValueCategory) => void
}

export function ValuePill({ category: initialCategory, onChange }: ValuePillProps) {
  const [category, setCategory] = useState<ValueCategory>(initialCategory)

  const cycle = useCallback(() => {
    const idx = categoryOrder.indexOf(category)
    const next = categoryOrder[(idx + 1) % categoryOrder.length]
    setCategory(next)
    onChange?.(next)
  }, [category, onChange])

  const cat = valueCategories[category] ?? valueCategories.unsure

  return (
    <button
      onClick={cycle}
      className="font-data text-[8px] px-2 py-[3px] rounded tracking-[0.03em] cursor-pointer mt-[3px] active:opacity-80 transition-opacity"
      style={{
        backgroundColor: cat.bg,
        color: cat.color,
        border: 'border' in cat ? cat.border : 'none',
      }}
    >
      {cat.label}
    </button>
  )
}
