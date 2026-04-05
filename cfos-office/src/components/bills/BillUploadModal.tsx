'use client'

import { useState, useRef } from 'react'
import type { BillRecord } from './BillCard'

interface Props {
  bill?: BillRecord | null
  onClose: () => void
  onConfirmed: () => void
}

interface ExtractionData {
  provider: string
  bill_type: string
  billing_period: { start: string; end: string } | null
  total_amount: number
  currency: string
  consumption_kwh: number | null
  tariff_type: string | null
  power_contracted_kw: number | null
  consumption_m3: number | null
  plan_name: string | null
  speed_mbps: number | null
  data_gb: number | null
  coverage_type: string | null
  coverage_details: string | null
  contract_end_date: string | null
  has_permanencia: boolean | null
  permanencia_end_date: string | null
  confidence: string
}

type Stage = 'select' | 'uploading' | 'review' | 'saving' | 'error'

export function BillUploadModal({ bill, onClose, onConfirmed }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('select')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [extraction, setExtraction] = useState<ExtractionData | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleUpload(files: File[]) {
    setStage('uploading')
    setError(null)

    try {
      const formData = new FormData()
      // Append all files — API treats them as pages of one bill
      for (const file of files) {
        formData.append('file', file)
      }
      if (bill?.id) formData.append('bill_id', bill.id)

      const res = await fetch('/api/bills/upload', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Upload failed')
        setStage('error')
        return
      }

      setExtraction(data.extraction)
      setFilePath(data.file_path)
      setStage('review')
    } catch {
      setError('Upload failed. Please try again.')
      setStage('error')
    }
  }

  async function handleConfirm() {
    if (!extraction) return
    setStage('saving')

    try {
      const res = await fetch('/api/bills/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bill_id: bill?.id || null,
          extraction,
          file_path: filePath,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to save')
        setStage('error')
        return
      }

      onConfirmed()
    } catch {
      setError('Failed to save. Please try again.')
      setStage('error')
    }
  }

  function handleEditField(field: keyof ExtractionData, value: unknown) {
    if (!extraction) return
    setExtraction({ ...extraction, [field]: value })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">
            {stage === 'review' ? 'Confirm Bill Details' : 'Upload Bill'}
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        <div className="p-4">
          {/* File selection */}
          {stage === 'select' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Upload a bill (PDF or image) to extract plan details, consumption data, and contract information. Select multiple images if the bill has more than one page.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.heic,.webp"
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files
                  if (files && files.length > 0) {
                    setSelectedFiles(Array.from(files))
                  }
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3 px-4 border-2 border-dashed border-border rounded-lg text-sm text-muted-foreground hover:border-primary hover:text-foreground transition-colors min-h-[44px]"
              >
                {selectedFiles.length > 0
                  ? `${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''} selected`
                  : 'Choose files'}
              </button>
              {selectedFiles.length > 0 && (
                <div className="space-y-1">
                  {selectedFiles.map((f, i) => (
                    <div key={i} className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="truncate">{f.name}</span>
                      <button
                        onClick={() => setSelectedFiles(selectedFiles.filter((_, j) => j !== i))}
                        className="text-muted-foreground hover:text-foreground ml-2 flex-shrink-0"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => handleUpload(selectedFiles)}
                    className="w-full bg-primary text-primary-foreground text-sm font-medium rounded-lg py-2.5 min-h-[44px] hover:bg-primary/90 transition-colors mt-2"
                  >
                    Extract Bill Details
                  </button>
                </div>
              )}
              <p className="text-xs text-muted-foreground text-center">
                Accepts PDF, PNG, JPG, HEIC — select all pages of one bill together
              </p>
            </div>
          )}

          {/* Uploading / extracting */}
          {stage === 'uploading' && (
            <div className="flex flex-col items-center py-8 gap-3">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">Extracting bill details...</p>
            </div>
          )}

          {/* Review extracted data */}
          {stage === 'review' && extraction && (
            <div className="space-y-3">
              <div className={`text-xs px-2 py-1 rounded inline-block ${
                extraction.confidence === 'high'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : extraction.confidence === 'medium'
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'bg-red-500/10 text-red-600 dark:text-red-400'
              }`}>
                {extraction.confidence} confidence extraction
              </div>

              <EditableRow label="Provider" value={extraction.provider} onChange={(v) => handleEditField('provider', v)} />
              <EditableRow label="Amount" value={String(extraction.total_amount)} onChange={(v) => handleEditField('total_amount', Number(v))} />
              <EditableRow label="Currency" value={extraction.currency} onChange={(v) => handleEditField('currency', v)} />

              {extraction.billing_period && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Period: </span>
                  <span className="text-foreground">
                    {extraction.billing_period.start} to {extraction.billing_period.end}
                  </span>
                </div>
              )}

              {extraction.consumption_kwh != null && (
                <EditableRow label="Consumption (kWh)" value={String(extraction.consumption_kwh)} onChange={(v) => handleEditField('consumption_kwh', Number(v))} />
              )}
              {extraction.consumption_m3 != null && (
                <EditableRow label="Consumption (m³)" value={String(extraction.consumption_m3)} onChange={(v) => handleEditField('consumption_m3', Number(v))} />
              )}
              {extraction.tariff_type && (
                <EditableRow label="Tariff" value={extraction.tariff_type} onChange={(v) => handleEditField('tariff_type', v)} />
              )}
              {extraction.power_contracted_kw != null && (
                <EditableRow label="Contracted power (kW)" value={String(extraction.power_contracted_kw)} onChange={(v) => handleEditField('power_contracted_kw', Number(v))} />
              )}
              {extraction.plan_name && (
                <EditableRow label="Plan" value={extraction.plan_name} onChange={(v) => handleEditField('plan_name', v)} />
              )}
              {extraction.speed_mbps != null && (
                <EditableRow label="Speed (Mbps)" value={String(extraction.speed_mbps)} onChange={(v) => handleEditField('speed_mbps', Number(v))} />
              )}
              {extraction.contract_end_date && (
                <EditableRow label="Contract ends" value={extraction.contract_end_date} onChange={(v) => handleEditField('contract_end_date', v)} />
              )}
              {extraction.has_permanencia && (
                <div className="text-sm">
                  <span className="text-amber-600 dark:text-amber-400">Has lock-in period (permanencia)</span>
                </div>
              )}

              <div className="flex gap-2 pt-3">
                <button
                  onClick={handleConfirm}
                  className="flex-1 bg-primary text-primary-foreground text-sm font-medium rounded-lg py-2.5 min-h-[44px] hover:bg-primary/90 transition-colors"
                >
                  Confirm &amp; Save
                </button>
                <button
                  onClick={onClose}
                  className="px-4 text-sm text-muted-foreground hover:text-foreground min-h-[44px] transition-colors"
                >
                  Discard
                </button>
              </div>
            </div>
          )}

          {/* Saving */}
          {stage === 'saving' && (
            <div className="flex flex-col items-center py-8 gap-3">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">Saving...</p>
            </div>
          )}

          {/* Error */}
          {stage === 'error' && (
            <div className="space-y-4">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              <button
                onClick={() => { setStage('select'); setSelectedFiles([]); }}
                className="text-sm text-primary hover:text-primary/80 font-medium min-h-[44px]"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function EditableRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(value)

  if (editing) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground min-w-[120px]">{label}:</span>
        <input
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={() => {
            onChange(editValue)
            setEditing(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onChange(editValue)
              setEditing(false)
            }
          }}
          className="flex-1 bg-transparent border-b border-primary text-foreground outline-none text-sm py-0.5"
        />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 text-sm group">
      <span className="text-muted-foreground min-w-[120px]">{label}:</span>
      <span className="text-foreground flex-1">{value}</span>
      <button
        onClick={() => {
          setEditValue(value)
          setEditing(true)
        }}
        className="text-xs text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity"
      >
        Edit
      </button>
    </div>
  )
}
