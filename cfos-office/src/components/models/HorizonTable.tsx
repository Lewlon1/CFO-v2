'use client'

import { Card } from '@/components/ui/Card'
import { gbp } from '@/lib/models/format'
import type { LeaderChange, ModelRow, ScenarioKey } from '@/lib/models/types'

// Short labels for the row headers — the full "Sell & redeploy into a new home"
// is too wide for a four-column table on a phone.
const SHORT_LABELS: Record<ScenarioKey, string> = {
  rent: 'Keep & rent',
  invest: 'Sell & invest',
  cash: 'Hold cash',
  redeploy: 'Redeploy',
}

export function HorizonTable({
  rows,
  horizons,
  statedHorizon,
  order,
  changes,
}: {
  rows: ModelRow[]
  horizons: number[]
  statedHorizon: number
  order: ScenarioKey[]
  changes: LeaderChange[]
}) {
  // The first leadership change past year 1 is the story worth telling.
  const flip = changes.find((c) => c.year > 1)

  return (
    <div className="mt-4">
      <div className="font-data text-[11px] tracking-widest text-accent-gold mb-1">TIMELINES</div>

      <div className="overflow-x-auto -mx-3 px-3">
        <table className="w-full min-w-[320px] border-collapse">
          <thead>
            <tr>
              <th className="text-left" />
              {horizons.map((h) => (
                <th
                  key={h}
                  className={`py-1 pl-3 text-right font-data text-[11px] tracking-wide ${
                    h === statedHorizon ? 'text-accent-gold' : 'text-text-tertiary'
                  }`}
                >
                  {h} YR
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.map((key) => (
              <tr key={key} className="border-t border-border-subtle">
                <td className="py-2 pr-3 text-[12px] text-text-primary whitespace-nowrap">{SHORT_LABELS[key]}</td>
                {horizons.map((h) => {
                  const stated = h === statedHorizon
                  return (
                    <td
                      key={h}
                      className="py-2 pl-3 text-right font-data text-[12px] tabular-nums"
                      style={{
                        color: stated ? 'var(--text-primary)' : 'var(--text-tertiary)',
                        fontWeight: stated ? 600 : 400,
                      }}
                    >
                      {gbp(rows[h]?.[key] ?? null)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {flip && (
        <Card variant="inset" className="mt-2 p-3 text-[13px] text-text-primary">
          {SHORT_LABELS[flip.to]} overtakes {SHORT_LABELS[flip.from].toLowerCase()} in year {flip.year}.
        </Card>
      )}
    </div>
  )
}
