'use client'

// VM-3 — the payback screen: the product's first proof that answering C.
// changes something immediately. Renders VERBATIM from the POST
// /api/value-map/onboarding response (RescoreResult + reconciliation query).
// Nothing here is estimated, narrated, or LLM-generated.
//
// VM-4: the archetype reveal renders before this screen (the 'reveal' step
// in onboarding-v2-flow.tsx). The numbers here are untouched; the only VM-4
// delta is the CTA label, which takes the deterministic family flavour when
// a family was assigned and stays neutral otherwise.

import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CFOAvatar } from '@/components/brand/CFOAvatar'
import { QUADRANTS, QUADRANT_ORDER } from '@/lib/value-map/constants'
import { formatAmount } from '@/lib/value-map/format'
import {
  VM3_PAYBACK_HEADING,
  VM3_PAYBACK_CTA,
  VM3_PAYBACK_MONTHLY_SUFFIX,
  vm3PaybackSummaryLine,
} from '@/lib/value-map/copy'
import type { PaybackSummary } from '@/lib/value-map/payback'
import type { ValueQuadrant } from '@/lib/value-map/types'
import {
  FAMILY_PAYBACK_CTA,
  type ArchetypeFamily,
} from '@/lib/value-map/taxonomy-config'

interface PaybackScreenProps {
  payback: PaybackSummary | null
  currency: string
  /** VM-4: assigned archetype family — flavours the CTA label only. */
  family?: string | null
  onContinue: () => void
}

function ctaLabel(family: string | null | undefined): string {
  if (family && family in FAMILY_PAYBACK_CTA) {
    return FAMILY_PAYBACK_CTA[family as ArchetypeFamily]
  }
  return VM3_PAYBACK_CTA
}

export function PaybackScreen({ payback, currency, family, onContinue }: PaybackScreenProps) {
  // No payback data (save failed downstream of the session write) — thank the
  // user without inventing numbers.
  if (!payback || payback.mappedTransactions === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6 text-center">
        <CFOAvatar size={48} />
        <div className="space-y-2 max-w-sm">
          <h1 className="text-xl font-semibold text-text-primary">Answers logged</h1>
          <p className="text-sm text-text-secondary leading-relaxed">
            Your answers are saved and working through your history.
          </p>
        </div>
        <ContinueButton label={ctaLabel(family)} onContinue={onContinue} />
      </div>
    )
  }

  const split = QUADRANT_ORDER.map((qId) => ({
    id: qId as ValueQuadrant,
    def: QUADRANTS[qId],
    amount: payback.monthlyByQuadrant[qId as ValueQuadrant] ?? 0,
  })).filter((s) => s.amount > 0)
  const splitTotal = split.reduce((a, s) => a + s.amount, 0)

  return (
    <div className="flex-1 flex flex-col items-center justify-start px-6 pt-12 pb-8 gap-6 text-center overflow-y-auto">
      <CFOAvatar size={48} />
      <div className="space-y-2 max-w-sm">
        <h1 className="text-xl font-semibold text-text-primary">{VM3_PAYBACK_HEADING}</h1>
        <p className="text-sm text-text-secondary leading-relaxed">
          {vm3PaybackSummaryLine(payback.answers, payback.mappedTransactions)}
        </p>
      </div>

      <div className="w-full max-w-sm space-y-4">
        <div className="rounded-card border border-[var(--border-subtle)] bg-bg-elevated px-5 py-4">
          <p className="font-data text-2xl font-bold text-text-primary">
            {formatAmount(payback.monthlyMapped, currency)}
          </p>
          <p className="mt-1 text-xs text-text-secondary">{VM3_PAYBACK_MONTHLY_SUFFIX}</p>
        </div>

        {/* Quadrant split of what they just mapped */}
        {splitTotal > 0 && (
          <div className="space-y-2">
            <div className="flex h-2 w-full rounded-full overflow-hidden bg-border">
              {split.map((s) => (
                <div
                  key={s.id}
                  className="h-full"
                  style={{
                    width: `${(s.amount / splitTotal) * 100}%`,
                    backgroundColor: s.def.colour,
                  }}
                />
              ))}
            </div>
            <div className="flex flex-col gap-1">
              {split.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-text-secondary">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: s.def.colour }}
                      aria-hidden
                    />
                    {s.def.name}
                  </span>
                  <span className="font-data text-text-primary">
                    {formatAmount(s.amount, currency)}/mo
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <ContinueButton label={ctaLabel(family)} onContinue={onContinue} />
    </div>
  )
}

function ContinueButton({ label, onContinue }: { label: string; onContinue: () => void }) {
  return (
    <Button
      onClick={onContinue}
      className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-8 py-5 text-base min-h-11 mt-2"
    >
      {label}
      <ArrowRight className="ml-2 h-4 w-4" />
    </Button>
  )
}
