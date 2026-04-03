'use client'

import { useState, useRef, useEffect } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CfoAvatar } from '@/components/chat/cfo-avatar'

function currencySymbol(currency: string): string {
  return { GBP: '\u00A3', USD: '$', EUR: '\u20AC' }[currency] ?? currency + ' '
}

interface AnchoringQuestionProps {
  category: string
  categoryLabel: string
  currency: string
  onSubmit: (guess: number) => void
}

export function AnchoringQuestion({ category, categoryLabel, currency, onSubmit }: AnchoringQuestionProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = () => {
    const num = parseFloat(value)
    if (!num || num <= 0) return
    onSubmit(num)
  }

  const questionText = category === 'all' || !category
    ? 'Quick guess \u2014 how much do you think you spent in total last month?'
    : `Quick guess \u2014 how much do you think you spent on ${categoryLabel.toLowerCase()} last month?`

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 gap-6 text-center animate-value-feedback">
      <CfoAvatar size="sm" />

      <div className="rounded-xl border border-[#E8A84C]/30 bg-[#E8A84C]/5 p-4 max-w-sm">
        <p className="text-sm text-foreground leading-relaxed">
          {questionText}
        </p>
      </div>

      <div className="flex items-center gap-1 max-w-[200px]">
        <span className="text-3xl font-mono font-bold text-muted-foreground">
          {currencySymbol(currency)}
        </span>
        <input
          ref={inputRef}
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="0"
          className="w-full bg-transparent border-b-2 border-[#E8A84C]/50 focus:border-[#E8A84C] outline-none text-3xl font-mono font-bold text-foreground text-center py-2 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
      </div>

      <Button
        onClick={handleSubmit}
        disabled={!value || parseFloat(value) <= 0}
        className="bg-[#E8A84C] hover:bg-[#d4963f] text-black font-semibold px-8 py-5 text-base disabled:opacity-40"
      >
        Submit
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  )
}
