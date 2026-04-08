'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'
import { formatCurrency } from '@/lib/constants/dashboard'
import { GroupIcon } from './icons'
import { HoldingsDetail } from './HoldingsDetail'
import type { BalanceSheetAssetGroup } from '@/app/api/balance-sheet/route'

type Props = {
  group: BalanceSheetAssetGroup
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

export function AssetGroupCard({ group, currency }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)

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
            <p className="text-sm font-medium text-foreground">{group.label}</p>
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
          const canExpand = item.holdings_count > 0
          const isOpen = expanded === item.id
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => canExpand && setExpanded(isOpen ? null : item.id)}
                className={`w-full text-left px-4 py-3 transition-colors min-h-[44px] ${
                  canExpand ? 'hover:bg-muted/40 cursor-pointer' : 'cursor-default'
                }`}
                aria-expanded={canExpand ? isOpen : undefined}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
                      {canExpand && (
                        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {item.holdings_count} holdings
                        </span>
                      )}
                      {item.is_stale && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          Stale
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                      {item.provider && <span>{item.provider}</span>}
                      {item.provider && <span>•</span>}
                      <span>Updated {relativeTime(item.last_updated)}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold text-foreground tabular-nums">
                      {formatCurrency(item.current_value, item.currency || currency)}
                    </p>
                    {item.gain_loss_pct != null && (
                      <p
                        className={`text-[11px] tabular-nums ${
                          item.gain_loss_pct >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {item.gain_loss_pct >= 0 ? '+' : ''}
                        {item.gain_loss_pct.toFixed(1)}%
                      </p>
                    )}
                  </div>
                  {canExpand && (
                    <div className="flex items-center text-muted-foreground">
                      {isOpen ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </div>
                  )}
                </div>
              </button>
              {canExpand && isOpen && (
                <div className="px-4 pb-4">
                  <HoldingsDetail assetId={item.id} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
