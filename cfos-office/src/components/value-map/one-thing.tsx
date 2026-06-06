'use client'

import { useState, useRef, useEffect } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CFOAvatar } from '@/components/brand/CFOAvatar'

const MAX_LENGTH = 200

interface OneThingProps {
  onSubmit: (text: string) => void
  onSkip: () => void
}

export function OneThing({ onSubmit, onSkip }: OneThingProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (!trimmed) return
    onSubmit(trimmed)
  }

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 gap-6 text-center animate-value-feedback">
      <CFOAvatar size={24} />

      <div className="rounded-card border border-accent-gold/30 bg-accent-gold/5 p-4 max-w-sm">
        <p className="text-sm text-text-primary leading-relaxed">
          If I could change one thing about your finances, what would it be?
        </p>
      </div>

      <div className="w-full max-w-sm space-y-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, MAX_LENGTH))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSubmit()
            }
          }}
          placeholder="e.g. Stop wasting money on takeaways"
          rows={3}
          className="w-full rounded-lg border border-[var(--border-subtle)] bg-bg-base px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary focus:border-accent-gold focus:outline-none resize-none"
        />
        <p className="text-xs text-text-secondary text-right">
          {value.length}/{MAX_LENGTH}
        </p>
      </div>

      <div className="flex flex-col gap-2 w-full max-w-sm">
        <Button
          onClick={handleSubmit}
          disabled={!value.trim()}
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-5 text-base disabled:opacity-40"
        >
          Continue
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          onClick={onSkip}
          className="text-text-secondary text-sm"
        >
          Skip for now
        </Button>
      </div>
    </div>
  )
}
