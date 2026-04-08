'use client'

import Link from 'next/link'
import { CheckCircle2, AlertTriangle, Info, ArrowRight } from 'lucide-react'
import type { DataGap } from '@/app/api/balance-sheet/route'

type Props = {
  gaps: DataGap[]
}

export function DataGaps({ gaps }: Props) {
  if (gaps.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-muted-foreground mb-3">Your Picture</h3>
        <div className="flex items-center gap-2 text-sm text-emerald-400">
          <CheckCircle2 className="w-4 h-4" />
          <span>Your CFO has a complete picture of your finances</span>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-muted-foreground mb-3">Complete your picture</h3>
      <ul className="space-y-2">
        {gaps.map((gap) => {
          const Icon = gap.severity === 'warning' ? AlertTriangle : Info
          return (
            <li key={gap.type}>
              <Link
                href={gap.action_href}
                className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-md hover:bg-muted/40 transition-colors min-h-[44px] group"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon
                    className={`w-4 h-4 flex-shrink-0 ${
                      gap.severity === 'warning' ? 'text-amber-400' : 'text-blue-400'
                    }`}
                  />
                  <span className="text-sm text-foreground truncate">{gap.message}</span>
                </div>
                <span className="text-xs text-muted-foreground group-hover:text-foreground flex items-center gap-1 flex-shrink-0">
                  {gap.action_label.replace(/\s*\u2192$/, '')}
                  <ArrowRight className="w-3 h-3" />
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
