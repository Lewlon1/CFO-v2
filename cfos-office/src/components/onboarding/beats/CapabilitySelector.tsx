'use client'

import { useState, useCallback } from 'react'
import { CAPABILITY_OPTIONS } from '@/lib/onboarding/constants'
import { useTrackOnboarding } from '@/lib/analytics/onboarding-events'

interface CapabilitySelectorProps {
  onComplete: (selected: string[]) => void
}

export function CapabilitySelector({ onComplete }: CapabilitySelectorProps) {
  const [selected, setSelected] = useState<string[]>([])
  const trackOnboarding = useTrackOnboarding()

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = prev.includes(id)
        ? prev.filter((s) => s !== id)
        : [...prev, id]
      return next
    })
  }, [])

  const handleContinue = useCallback(() => {
    trackOnboarding('capability_selected', { capabilities: selected })
    onComplete(selected)
  }, [selected, onComplete, trackOnboarding])

  return (
    <div className="px-4 py-2 ml-[40px] animate-[fade-in_0.3s_ease-out]">
      <div className="grid grid-cols-1 gap-2 max-w-sm">
        {CAPABILITY_OPTIONS.map((cap) => {
          const isSelected = selected.includes(cap.id)
          return (
            <button
              key={cap.id}
              onClick={() => toggle(cap.id)}
              className={`flex items-center gap-3 px-4 py-3.5 rounded-lg border text-left transition-all min-h-[44px]
                ${isSelected
                  ? 'border-[var(--accent-gold)] bg-[var(--bg-elevated)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-card)] hover:border-[var(--border-visible)]'
                }`}
            >
              <span
                className="w-8 h-8 rounded-md flex items-center justify-center text-sm font-semibold shrink-0"
                style={{
                  backgroundColor: isSelected ? cap.color : 'var(--bg-inset)',
                  color: isSelected ? '#0F0F0D' : cap.color,
                }}
              >
                {cap.icon}
              </span>
              <div className="min-w-0">
                <p className="text-sm text-[var(--text-primary)] font-medium leading-tight">
                  {cap.label}
                </p>
                <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                  {cap.folder}
                </p>
              </div>
              {isSelected && (
                <span className="ml-auto text-[var(--accent-gold)] text-sm">&#10003;</span>
              )}
            </button>
          )
        })}
      </div>

      {selected.length > 0 && (
        <button
          onClick={handleContinue}
          className="mt-4 px-5 py-2.5 rounded-lg bg-[var(--accent-gold)] text-[#0F0F0D] text-sm font-semibold
                     hover:brightness-110 active:scale-[0.98] transition-all min-h-[44px]"
        >
          Continue
        </button>
      )}
    </div>
  )
}
