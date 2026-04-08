'use client'

import { AlertTriangle, Star } from 'lucide-react'
import { formatCurrency } from '@/lib/constants/dashboard'
import { GroupIcon } from './icons'
import type { BalanceSheetLiabilityGroup } from '@/app/api/balance-sheet/route'

type Props = {
  group: BalanceSheetLiabilityGroup
  currency: string
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'Unknown'
  const updated = new Date(iso).getTime()
  const days = Math.floor((Date.now() - updated) / (24 * 60 * 60 * 1000))
  if (days < 1) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days} days ago`
  if (days < 60) return '1 month ago'
  if (days < 365) return `${Math.floor(days / 30)} months ago`
  return `${Math.floor(days / 365)} years ago`
}

export function LiabilityGroupCard({ group, currency }: Props) {
  const hasPriority = group.items.some((i) => i.is_priority)

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-border"
        style={{ borderLeft: `3px solid ${group.color}` }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${group.color}20`, color: group.color }}
          >
            <GroupIcon name={group.icon} className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground flex items-center gap-2">
              {group.label}
              {hasPriority && (
                <span className="inline-flex items-center gap-1 text-[10px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">
                  <Star className="w-2.5 h-2.5 fill-current" />
                  Priority
                </span>
              )}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {group.items.length} {group.items.length === 1 ? 'item' : 'items'}
            </p>
          </div>
        </div>
        <p className="text-base font-semibold text-foreground tabular-nums">
          {formatCurrency(group.total, currency)}
        </p>
      </div>

      <ul className="divide-y divide-border">
        {group.items.map((item) => {
          const monthlyPay = item.actual_payment ?? item.minimum_payment
          return (
            <li
              key={item.id}
              className={`px-4 py-3 ${
                item.is_priority ? 'bg-red-500/5 border-l-2 border-red-500/40' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
                    {item.is_stale && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        Stale
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5 flex-wrap">
                    {item.provider && <span>{item.provider}</span>}
                    {item.interest_rate != null && (
                      <>
                        <span>•</span>
                        <span>{item.interest_rate.toFixed(2)}% APR</span>
                      </>
                    )}
                    {monthlyPay != null && (
                      <>
                        <span>•</span>
                        <span>
                          {formatCurrency(monthlyPay, item.currency || currency)}/{item.payment_frequency === 'monthly' ? 'mo' : item.payment_frequency}
                        </span>
                      </>
                    )}
                  </div>
                  {item.monthly_interest != null && item.monthly_interest > 0 && (
                    <p className="text-[11px] text-amber-400 mt-1">
                      Costing you {formatCurrency(item.monthly_interest, item.currency || currency)}/mo in interest
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Updated {relativeTime(item.last_updated)}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-semibold text-foreground tabular-nums">
                    {formatCurrency(item.outstanding_balance, item.currency || currency)}
                  </p>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
