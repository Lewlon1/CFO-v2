'use client'

import { useState, useRef, useEffect } from 'react'

type ValueCategory = 'foundation' | 'investment' | 'leak' | 'burden' | 'no_idea'

type Props = {
  transactionId: string
  currentCategory: string | null
  confidence: number
  description: string
  onUpdate: (newCategory: string) => void
  defaultExpanded?: boolean
}

const OPTIONS: { value: ValueCategory; label: string; bg: string; text: string; ring: string }[] = [
  { value: 'foundation', label: 'Foundation', bg: 'bg-blue-100', text: 'text-blue-800', ring: 'ring-blue-300' },
  { value: 'investment', label: 'Investment', bg: 'bg-green-100', text: 'text-green-800', ring: 'ring-green-300' },
  { value: 'leak', label: 'Leak', bg: 'bg-red-100', text: 'text-red-800', ring: 'ring-red-300' },
  { value: 'burden', label: 'Burden', bg: 'bg-amber-100', text: 'text-amber-800', ring: 'ring-amber-300' },
  { value: 'no_idea', label: 'Unsure', bg: 'bg-gray-100', text: 'text-gray-500', ring: 'ring-gray-300' },
]

export function ValueCategoryPill({
  transactionId,
  currentCategory,
  confidence,
  description,
  onUpdate,
  defaultExpanded = false,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!expanded) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [expanded])

  const current = OPTIONS.find((o) => o.value === currentCategory) ?? null

  async function selectCategory(value: ValueCategory) {
    if (saving) return
    const prev = currentCategory

    // Optimistic update
    onUpdate(value)
    setExpanded(false)
    setSaving(true)
    setError(false)

    try {
      const res = await fetch('/api/corrections/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_id: transactionId, value_category: value }),
      })
      if (!res.ok) throw new Error()
    } catch {
      // Revert on failure
      if (prev !== null) onUpdate(prev)
      setError(true)
      setTimeout(() => setError(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  // ── Collapsed pill ──────────────────────────────────────────────────

  if (!expanded) {
    // Null state: "+" icon
    if (!current) {
      return (
        <div ref={containerRef}>
          <button
            onClick={() => setExpanded(true)}
            className="inline-flex items-center justify-center w-7 h-7 rounded-full border border-dashed border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-500 transition-colors min-h-[44px] min-w-[44px]"
            aria-label="Assign value category"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M7 1v12M1 7h12" />
            </svg>
          </button>
        </div>
      )
    }

    // Confidence-based styling
    let pillClasses = `${current.bg} ${current.text}`
    let borderClasses = ''
    let suffix = ''

    if (confidence >= 0.75) {
      // Solid, full colour
    } else if (confidence >= 0.5) {
      // Slightly muted
      pillClasses += ' opacity-85'
    } else if (confidence > 0.25) {
      // Dashed border
      borderClasses = 'border border-dashed border-current'
      pillClasses += ' opacity-75'
    } else {
      // Ghost state
      pillClasses = 'bg-gray-50 text-gray-400'
      suffix = '?'
    }

    return (
      <div ref={containerRef} className="relative">
        <button
          onClick={() => setExpanded(true)}
          className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium min-h-[44px] min-w-[44px] justify-center transition-all ${pillClasses} ${borderClasses}`}
          title={confidence < 1 ? `Confidence: ${Math.round(confidence * 100)}%` : undefined}
        >
          {confidence <= 0.25 ? '?' : current.label}
          {suffix && confidence > 0.25 && <span className="opacity-60">{suffix}</span>}
        </button>
        {error && (
          <span className="absolute -bottom-5 left-0 text-[10px] text-red-500 whitespace-nowrap">
            Failed to save
          </span>
        )}
      </div>
    )
  }

  // ── Expanded options ────────────────────────────────────────────────

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex items-center gap-1 animate-in fade-in slide-in-from-left-2 duration-150"
        role="radiogroup"
        aria-label="Value category"
      >
        {OPTIONS.map((opt) => {
          const isActive = opt.value === currentCategory
          return (
            <button
              key={opt.value}
              onClick={() => selectCategory(opt.value)}
              disabled={saving}
              className={`
                inline-flex items-center px-2 py-1 rounded-full text-xs font-medium
                min-h-[44px] min-w-[44px] justify-center
                transition-all duration-100
                ${isActive ? `${opt.bg} ${opt.text} ring-2 ${opt.ring}` : `${opt.bg} ${opt.text} opacity-60 hover:opacity-90`}
                disabled:opacity-40
              `}
              role="radio"
              aria-checked={isActive}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
      {error && (
        <span className="absolute -bottom-5 left-0 text-[10px] text-red-500 whitespace-nowrap">
          Failed to save
        </span>
      )}
    </div>
  )
}
