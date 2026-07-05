'use client'

import { useState } from 'react'
import { InterviewPanel } from '@/components/models/InterviewPanel'
import { AssumptionsLedger } from '@/components/models/AssumptionsLedger'
import { VerdictPanel } from '@/components/models/VerdictPanel'
import { PROPERTY_SLOTS } from '@/lib/models/registry'
import { MARKET_DEFAULTS } from '@/lib/models/marketDefaults'
import { resolveRunValues } from '@/lib/models/resolve'
import { runModel, flipPoint } from '@/lib/models/engine/property'
import type { SlotMap } from '@/lib/models/types'

interface RunData {
  id: string
  decision_type: string
  status: string
  assumptions: SlotMap
  messages: Array<{ role: string; text: string; challenge?: boolean; done?: boolean }>
  caveats: string[]
}

type Tab = 'interview' | 'ledger' | 'verdict'

export function RunClient({
  run,
  profile,
}: {
  run: RunData
  profile: { default_horizon_years: number | null } | null
}) {
  const [assumptions, setAssumptions] = useState<SlotMap>(run.assumptions)
  const [messages, setMessages] = useState(run.messages)
  const [tab, setTab] = useState<Tab>('interview')

  const resolved = resolveRunValues(assumptions, profile, PROPERTY_SLOTS, MARKET_DEFAULTS)
  const requiredIds = PROPERTY_SLOTS.filter((s) => s.required).map((s) => s.id)
  const filledRequired = requiredIds.filter((id) => resolved.values[id] !== null)
  const ready = filledRequired.length === requiredIds.length

  const model = ready ? runModel(resolved.values as Record<string, number>) : null
  const flips = ready
    ? [flipPoint(resolved.values as Record<string, number>, 'appreciation_pct', -2, 12)]
    : []

  const onEdit = async (slotId: string, value: number) => {
    setAssumptions((prev) => ({ ...prev, [slotId]: { value, origin: 'edited' } }))
    await fetch(`/api/models/runs/${run.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot_id: slotId, value }),
    })
  }

  const onExtracted = (extracted: Array<{ id: string; value: number; origin: string }>) => {
    setAssumptions((prev) => {
      const next = { ...prev }
      for (const e of extracted) {
        next[e.id] = { value: e.value, origin: e.origin === 'market' ? 'market' : 'user' }
      }
      return next
    })
  }

  return (
    <div className="h-full flex flex-col">
      <div className="md:hidden flex border-b border-border-subtle">
        {(['interview', 'ledger', 'verdict'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 py-2 font-data text-[11px] tracking-wide border-b-2"
            style={{ borderColor: tab === t ? 'var(--accent-gold)' : 'transparent' }}
          >
            {t.toUpperCase()}
            {t === 'ledger' ? ` ${filledRequired.length}/${requiredIds.length}` : ''}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden md:grid md:grid-cols-5">
        <div className={`${tab === 'interview' ? 'block' : 'hidden'} md:block md:col-span-2 h-full border-r border-border-subtle`}>
          <InterviewPanel runId={run.id} messages={messages} setMessages={setMessages} onExtracted={onExtracted} />
        </div>
        <div className={`${tab === 'ledger' ? 'block' : 'hidden'} md:block md:col-span-1 h-full border-r border-border-subtle overflow-y-auto`}>
          <AssumptionsLedger
            resolved={resolved}
            requiredIds={requiredIds}
            filledCount={filledRequired.length}
            onEdit={onEdit}
          />
        </div>
        <div className={`${tab === 'verdict' ? 'block' : 'hidden'} md:block md:col-span-2 h-full overflow-y-auto`}>
          <VerdictPanel model={model} resolved={resolved} flips={flips} filledCount={filledRequired.length} totalRequired={requiredIds.length} />
        </div>
      </div>
    </div>
  )
}
