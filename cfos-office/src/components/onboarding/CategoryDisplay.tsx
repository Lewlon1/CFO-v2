'use client'

import { ONBOARDING_VALUE_CATEGORIES } from '@/lib/onboarding/constants'

export function CategoryDisplay() {
  return (
    <div className="grid grid-cols-2 gap-2 max-w-sm">
      {ONBOARDING_VALUE_CATEGORIES.map((cat) => (
        <div
          key={cat.id}
          className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)]"
          style={cat.id === 'unsure' ? { borderStyle: 'dashed', borderColor: 'rgba(232,168,76,0.3)' } : {}}
        >
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: cat.color }}
          />
          <div className="min-w-0">
            <p className="text-xs font-medium text-[var(--text-primary)] leading-tight">{cat.label}</p>
            <p className="text-[10px] text-[var(--text-secondary)] leading-tight mt-0.5">{cat.description}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
