'use client'

import { useState, useRef, useEffect } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CfoAvatar } from '@/components/chat/cfo-avatar'

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
      <CfoAvatar size="sm" />

      <div className="rounded-xl border border-[#E8A84C]/30 bg-[#E8A84C]/5 p-4 max-w-sm">
        <p className="text-sm text-foreground leading-relaxed">
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
          className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-[#E8A84C] focus:outline-none resize-none"
        />
        <p className="text-xs text-muted-foreground text-right">
          {value.length}/{MAX_LENGTH}
        </p>
      </div>

      <div className="flex flex-col gap-2 w-full max-w-sm">
        <Button
          onClick={handleSubmit}
          disabled={!value.trim()}
          className="w-full bg-[#E8A84C] hover:bg-[#d4963f] text-black font-semibold py-5 text-base disabled:opacity-40"
        >
          Continue
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          onClick={onSkip}
          className="text-muted-foreground text-sm"
        >
          Skip for now
        </Button>
      </div>
    </div>
  )
}
