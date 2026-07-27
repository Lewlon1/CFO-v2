'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { PROPERTY_SLOTS, activeSlots } from '@/lib/models/registry'
import type { ResolvedValues, SlotOrigin } from '@/lib/models/types'

const ORIGIN_TONE: Record<SlotOrigin, 'gold' | 'neutral' | 'info'> = {
  user: 'gold',
  edited: 'neutral',
  market: 'info',
  profile: 'info',
}

function formatValue(unit: string, value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—'
  if (unit === 'bool') return value === 1 ? 'Yes' : 'No'
  if (unit.startsWith('£')) return `£${Math.round(value).toLocaleString('en-GB')}`
  return `${value}`
}

export function AssumptionsLedger({
  resolved,
  requiredIds,
  filledCount,
  onEdit,
}: {
  resolved: ResolvedValues
  requiredIds: string[]
  filledCount: number
  onEdit: (slotId: string, value: number) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editVal, setEditVal] = useState('')

  const visible = activeSlots(resolved.values).filter((s) => s.unit !== 'bool')
  const groups = visible.reduce<Record<string, typeof visible>>((acc, s) => {
    ;(acc[s.group] ??= []).push(s)
    return acc
  }, {})

  const commit = (slotId: string) => {
    // Guards against the blur-on-unmount that fires when the input is removed
    // after Enter/Escape already handled the field (would otherwise double-commit
    // on Enter, or commit anyway after Escape).
    if (editingId !== slotId) return
    const n = Number(editVal.replace(/,/g, ''))
    setEditingId(null)
    if (Number.isNaN(n)) return
    onEdit(slotId, n)
  }

  const cancel = () => setEditingId(null)

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-3 pt-3 pb-1">
        <div className="font-data text-[11px] tracking-widest text-accent-gold">ASSUMPTIONS LEDGER</div>
        <div className="text-[11px] text-text-tertiary mt-0.5">
          {filledCount}/{requiredIds.length} required
        </div>
      </div>

      {Object.entries(groups).map(([group, slots]) => (
        <div key={group} className="mt-2">
          <div className="px-3 py-1 font-data text-[10px] tracking-widest text-text-muted">{group.toUpperCase()}</div>
          {slots.map((slot) => {
            const value = resolved.values[slot.id]
            const origin = resolved.provenance[slot.id]
            const missing = slot.required && value === null
            const isEditing = editingId === slot.id

            return (
              <div key={slot.id} className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
                <div className="flex-1 min-w-0 text-[13px] text-text-primary truncate">{slot.label}</div>
                {isEditing ? (
                  <Input
                    autoFocus
                    value={editVal}
                    onChange={(e) => setEditVal(e.target.value)}
                    onBlur={() => commit(slot.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commit(slot.id)
                      if (e.key === 'Escape') cancel()
                    }}
                    className="w-24 text-right font-data text-[13px]"
                  />
                ) : (
                  <button
                    onClick={() => {
                      setEditingId(slot.id)
                      setEditVal(value === null ? '' : String(value))
                    }}
                    className="font-data text-[13px] tabular-nums text-right min-w-[5.5rem]"
                    style={{ color: missing ? 'var(--negative)' : 'var(--text-primary)' }}
                  >
                    {missing ? 'required' : formatValue(slot.unit, value)}
                  </button>
                )}
                {origin && !missing && (
                  <Badge tone={ORIGIN_TONE[origin]} className="shrink-0">
                    {origin}
                  </Badge>
                )}
              </div>
            )
          })}
        </div>
      ))}

      <div className="px-3 py-3 text-[11px] text-text-tertiary">
        Every figure is editable — tap a value.
      </div>
    </div>
  )
}

// PROPERTY_SLOTS retained for callers that need the full unfiltered set.
export { PROPERTY_SLOTS }
