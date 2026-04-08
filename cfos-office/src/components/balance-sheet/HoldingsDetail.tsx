'use client'

import useSWR from 'swr'
import { fetcher } from '@/lib/hooks/fetcher'
import { formatCurrency } from '@/lib/constants/dashboard'
import type { HoldingsResponse } from '@/app/api/balance-sheet/holdings/route'

type Props = {
  assetId: string
}

export function HoldingsDetail({ assetId }: Props) {
  const { data, error, isLoading } = useSWR<HoldingsResponse>(
    `/api/balance-sheet/holdings?asset_id=${assetId}`,
    fetcher
  )

  if (isLoading) {
    return <div className="h-32 bg-muted/40 rounded-md animate-pulse" />
  }
  if (error || !data) {
    return <p className="text-xs text-red-400">Could not load holdings.</p>
  }
  if (data.holdings.length === 0) {
    return <p className="text-xs text-muted-foreground py-2">No individual holdings recorded.</p>
  }

  const currency = data.asset_currency

  return (
    <div className="rounded-md border border-border bg-background overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2 font-medium">Name</th>
            <th className="text-left px-3 py-2 font-medium">Ticker</th>
            <th className="text-right px-3 py-2 font-medium">Quantity</th>
            <th className="text-right px-3 py-2 font-medium">Value</th>
            <th className="text-right px-3 py-2 font-medium">Cost</th>
            <th className="text-right px-3 py-2 font-medium">Gain/Loss</th>
            <th className="text-right px-3 py-2 font-medium">%</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.holdings.map((h) => (
            <tr key={h.id}>
              <td className="px-3 py-2 text-foreground truncate max-w-[200px]">{h.name}</td>
              <td className="px-3 py-2 text-muted-foreground">{h.ticker || '\u2014'}</td>
              <td className="px-3 py-2 text-right text-foreground tabular-nums">
                {h.quantity != null ? h.quantity.toLocaleString('en-GB') : '\u2014'}
              </td>
              <td className="px-3 py-2 text-right text-foreground tabular-nums">
                {h.current_value != null ? formatCurrency(h.current_value, h.currency || currency) : '\u2014'}
              </td>
              <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                {h.cost_basis != null ? formatCurrency(h.cost_basis, h.currency || currency) : '\u2014'}
              </td>
              <td
                className={`px-3 py-2 text-right tabular-nums ${
                  h.gain_loss_pct == null
                    ? 'text-muted-foreground'
                    : h.gain_loss_pct >= 0
                      ? 'text-emerald-400'
                      : 'text-red-400'
                }`}
              >
                {h.gain_loss_pct != null
                  ? `${h.gain_loss_pct >= 0 ? '+' : ''}${h.gain_loss_pct.toFixed(1)}%`
                  : '\u2014'}
              </td>
              <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                {h.allocation_pct != null ? `${h.allocation_pct.toFixed(1)}%` : '\u2014'}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-muted/40 font-medium">
          <tr>
            <td className="px-3 py-2 text-muted-foreground" colSpan={3}>
              Total
            </td>
            <td className="px-3 py-2 text-right text-foreground tabular-nums">
              {formatCurrency(data.asset_total, currency)}
            </td>
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
