'use client'

import { useState } from 'react'

interface Props {
  options: string[]
  onSelect: (option: string) => void
}

/**
 * One-shot option chips. A tap latches the whole set — the chips grey out and
 * stop accepting taps — because each tap fires a full chat turn (a Bedrock
 * request): before this latch, a double-tap fired two overlapping turns into
 * the same conversation (incident 2026-07-03). Mirrors ConfirmFact's
 * `answered` pattern. The provider's send guard is the backstop; this is the
 * affordance that stops the second tap existing at all.
 */
export function TappableOptions({ options, onSelect }: Props) {
  const [selected, setSelected] = useState<string | null>(null)

  function handleTap(option: string) {
    if (selected !== null) return
    setSelected(option)
    onSelect(option)
  }

  return (
    <div className="flex flex-col gap-2 mt-3 px-3">
      {options.map((option, i) => (
        <button
          key={i}
          onClick={() => handleTap(option)}
          disabled={selected !== null}
          className={`w-full px-4 py-3 rounded-xl border border-border bg-card
                     text-sm transition-colors min-h-[44px]
                     text-left transform ${
                       selected === null
                         ? 'text-foreground/80 hover:bg-accent active:bg-accent active:scale-[0.98]'
                         : selected === option
                           ? 'text-foreground/80 opacity-70'
                           : 'text-foreground/40 opacity-50'
                     }`}
        >
          {option}
        </button>
      ))}
    </div>
  )
}
