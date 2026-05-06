'use client'

import type { ReactNode } from 'react'
import { BarChart3, RefreshCw, Scissors } from 'lucide-react'
import { QUADRANTS } from '@/lib/value-map/constants'
import {
  PAYOFF_PANEL,
  GAP_SKETCH_FOOTNOTE,
  buildGapSketchCopy,
} from '@/lib/value-map/copy'

interface PayoffPanelProps {
  country: string
}

export function PayoffPanel({ country }: PayoffPanelProps) {
  const [b1, b2, b3] = PAYOFF_PANEL.bullets

  return (
    <div className="w-full max-w-sm space-y-5">
      <h3 className="text-base font-semibold text-foreground text-center">
        {PAYOFF_PANEL.heading}
      </h3>

      <div className="space-y-5">
        <PayoffRow icon={<BarChart3 className="h-4 w-4" />} title={b1.title} body={b1.body}>
          <GapInsightSketch country={country} />
        </PayoffRow>
        <PayoffRow icon={<Scissors className="h-4 w-4" />} title={b2.title} body={b2.body} />
        <PayoffRow icon={<RefreshCw className="h-4 w-4" />} title={b3.title} body={b3.body} />
      </div>

      <p className="text-xs text-muted-foreground text-center leading-relaxed">
        {PAYOFF_PANEL.closingLine}
      </p>
    </div>
  )
}

function PayoffRow({
  icon,
  title,
  body,
  children,
}: {
  icon: ReactNode
  title: string
  body: string
  children?: ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-[#E8A84C]">{icon}</span>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
        </div>
      </div>
      {children ? <div className="pl-7">{children}</div> : null}
    </div>
  )
}

function GapInsightSketch({ country }: { country: string }) {
  const sketch = buildGapSketchCopy(country)
  const investment = QUADRANTS.investment

  return (
    <div className="w-full">
      <div className="rounded-xl border-2 border-dashed border-border bg-card/50 p-3.5 space-y-3">
        <p className="text-[10px] font-medium tracking-[0.15em] text-muted-foreground uppercase">
          Example
        </p>

        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">You said</p>
          <div className="flex items-center gap-2 text-sm text-foreground/90">
            <span className="text-base leading-none">{investment.emoji}</span>
            <span>Gym</span>
            <span className="text-muted-foreground">&rarr;</span>
            <span style={{ color: investment.colour }} className="font-medium">
              Investment
            </span>
            <span
              className="ml-auto text-[10px] tracking-[0.1em]"
              style={{ color: investment.colour }}
            >
              &#9679;&#9679;&#9679;&#9679;&#9675;
            </span>
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">Reality</p>
          <p className="text-sm text-foreground/90">
            {sketch.currencySymbol}
            {sketch.monthlyAmount}/month
            <span className="text-muted-foreground"> &middot; </span>
            last visit {sketch.dormantDays} days ago
          </p>
        </div>

        <div className="border-t border-border/60 pt-2.5">
          <p className="text-xs text-foreground/80 italic leading-relaxed">
            &ldquo;That&rsquo;s {sketch.annualPhrase} for a Leak in disguise. Cancel, and{' '}
            {sketch.comparison}.&rdquo;
          </p>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground mt-2 text-center">
        {GAP_SKETCH_FOOTNOTE}
      </p>
    </div>
  )
}
