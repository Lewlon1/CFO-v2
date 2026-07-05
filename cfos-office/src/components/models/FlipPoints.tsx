'use client'

import { Card } from '@/components/ui/Card'

export function FlipPoints({ flips, currentAppreciation }: { flips: (number | null)[]; currentAppreciation: number }) {
  const appreciationFlip = flips[0]

  return (
    <div className="mt-4">
      <div className="font-data text-[11px] tracking-widest text-accent-gold mb-1">FLIP POINTS</div>
      <div className="space-y-2">
        {appreciationFlip !== null && appreciationFlip !== undefined ? (
          <Card variant="inset" className="p-3 text-[13px] text-text-primary">
            House price growth of {appreciationFlip.toFixed(1)}%/yr is the crossover — below it, selling &amp; investing wins; above it, keeping the property wins.
            <div className="text-[11px] text-text-tertiary mt-1">Current assumption: {currentAppreciation}%</div>
          </Card>
        ) : (
          <Card variant="inset" className="p-3 text-[13px] text-text-primary">
            No single-variable crossover within plausible ranges — the ranking is robust to any one assumption moving alone.
          </Card>
        )}
      </div>
    </div>
  )
}
