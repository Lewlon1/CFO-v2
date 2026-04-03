"use client"

import { useState } from "react"
import {
  Select,
  SelectTrigger,
  SelectPopup,
  SelectItem,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { ChevronDownIcon } from "lucide-react"
import type { SemanticField } from "@/lib/csv/column-detector"
import { SEMANTIC_FIELD_LABELS } from "@/lib/csv/column-detector"
import type { ColumnMapping } from "@/lib/csv/transform"
import type { BankAccount } from "@/lib/types/database"

const SEMANTIC_OPTIONS: SemanticField[] = [
  "date",
  "amount",
  "description",
  "merchant",
  "type",
  "category",
  "currency",
  "skip",
]

type Props = {
  headers: string[]
  previewRows: Record<string, string>[]
  mapping: ColumnMapping
  onMappingChange: (mapping: ColumnMapping) => void
  accounts: BankAccount[]
  selectedAccountId: string
  onAccountChange: (id: string) => void
}

export function CsvColumnMapper({
  headers,
  previewRows,
  mapping,
  onMappingChange,
  accounts,
  selectedAccountId,
  onAccountChange,
}: Props) {
  const [showSkipped, setShowSkipped] = useState(false)

  function setField(header: string, field: SemanticField) {
    onMappingChange({ ...mapping, [header]: field })
  }

  const mappedHeaders = headers.filter((h) => (mapping[h] ?? "skip") !== "skip")
  const skippedHeaders = headers.filter((h) => (mapping[h] ?? "skip") === "skip")

  const requiredFields: SemanticField[] = ["date", "amount"]
  const missingRequired = requiredFields.filter(
    (f) => !Object.values(mapping).includes(f)
  )

  return (
    <div className="space-y-6">
      {accounts.length >= 2 && (
        <div className="space-y-1.5">
          <Label>Which account does this CSV belong to?</Label>
          <Select
            value={selectedAccountId}
            onValueChange={(v: unknown) => onAccountChange(v as string)}
          >
            <SelectTrigger className="max-w-xs">
              {accounts.find((a) => a.id === selectedAccountId)
                ? <span>{accounts.find((a) => a.id === selectedAccountId)!.name}{accounts.find((a) => a.id === selectedAccountId)!.institution ? ` — ${accounts.find((a) => a.id === selectedAccountId)!.institution}` : ""}</span>
                : <span className="text-muted-foreground">Select account…</span>
              }
            </SelectTrigger>
            <SelectPopup>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}{a.institution ? ` — ${a.institution}` : ""}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium">Map your CSV columns</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            We auto-detected the columns below. Correct any that look wrong.
          </p>
        </div>

        {missingRequired.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-800/40 dark:bg-amber-950/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            Still needed: {missingRequired.map((f) => SEMANTIC_FIELD_LABELS[f]).join(", ")} — assign one of the skipped columns below.
          </div>
        )}

        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground w-1/3">Column</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground w-1/3">Maps to</th>
                {previewRows.slice(0, 3).map((_, i) => (
                  <th key={i} className="text-left px-3 py-2 font-medium text-muted-foreground">
                    Row {i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(showSkipped ? headers : mappedHeaders).map((header) => {
                const field = mapping[header] ?? "skip"
                return (
                  <tr key={header} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium truncate max-w-[120px]">{header}</td>
                    <td className="px-3 py-2">
                      <Select
                        value={field}
                        onValueChange={(v: unknown) => setField(header, v as SemanticField)}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <span className={field === "skip" ? "text-muted-foreground" : ""}>
                            {SEMANTIC_FIELD_LABELS[field]}
                          </span>
                        </SelectTrigger>
                        <SelectPopup>
                          {SEMANTIC_OPTIONS.map((opt) => (
                            <SelectItem key={opt} value={opt}>
                              {SEMANTIC_FIELD_LABELS[opt]}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    </td>
                    {previewRows.slice(0, 3).map((row, i) => (
                      <td key={i} className="px-3 py-2 text-muted-foreground truncate max-w-[120px]">
                        {row[header] ?? "—"}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {skippedHeaders.length > 0 && (
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowSkipped((s) => !s)}
          >
            <ChevronDownIcon className={`size-3 transition-transform ${showSkipped ? "rotate-180" : ""}`} />
            {showSkipped
              ? "Hide skipped columns"
              : `${skippedHeaders.length} column${skippedHeaders.length !== 1 ? "s" : ""} being skipped (${skippedHeaders.join(", ")})`
            }
          </button>
        )}
      </div>
    </div>
  )
}
