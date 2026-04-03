'use client'

import { useState } from 'react'
import { SEMANTIC_FIELD_LABELS } from '@/lib/csv/column-detector'
import type { SemanticField } from '@/lib/csv/column-detector'

type Props = {
  headers: string[]
  autoMapping: Record<string, string>
  onConfirm: (mapping: Record<string, string>) => void
  onCancel: () => void
}

const SEMANTIC_OPTIONS: SemanticField[] = [
  'date', 'amount', 'description', 'merchant', 'type', 'currency', 'category', 'skip',
]

export function ColumnMapper({ headers, autoMapping, onConfirm, onCancel }: Props) {
  const [mapping, setMapping] = useState<Record<string, string>>(autoMapping)

  const hasRequiredFields = () => {
    const vals = Object.values(mapping)
    return (
      vals.includes('date') &&
      vals.includes('amount') &&
      (vals.includes('description') || vals.includes('merchant'))
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-foreground">Map your columns</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          We couldn&apos;t auto-detect the column layout. Confirm which column is which.
        </p>
      </div>

      <div className="space-y-2">
        {headers.map((header) => (
          <div key={header} className="flex items-center gap-3">
            <span className="w-40 truncate text-sm font-mono text-muted-foreground shrink-0">
              {header}
            </span>
            <select
              value={mapping[header] ?? 'skip'}
              onChange={(e) => setMapping({ ...mapping, [header]: e.target.value })}
              className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              {SEMANTIC_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {SEMANTIC_FIELD_LABELS[opt]}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={() => onConfirm(mapping)}
          disabled={!hasRequiredFields()}
          className="flex-1 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          Continue
        </button>
        <button
          onClick={onCancel}
          className="rounded-md border border-input px-4 py-2 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
