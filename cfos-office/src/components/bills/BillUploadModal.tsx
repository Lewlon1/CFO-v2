'use client'

import { useState, useRef, useEffect } from 'react'
import type { BillRecord } from './BillCard'

interface Props {
  bill?: BillRecord | null
  onClose: () => void
  onConfirmed: () => void
  initialFiles?: File[]
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

type ExtractionOutcome =
  | { ok: true; fileName: string; extraction: ExtractionData }
  | { ok: false; fileName: string; error: string }

type SaveOutcome = { fileName: string; providerName: string; ok: boolean; error?: string }

type Stage = 'select' | 'uploading' | 'review' | 'saving' | 'summary' | 'error'

export function BillUploadModal({ bill, onClose, onConfirmed, initialFiles }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('select')
  const [selectedFiles, setSelectedFiles] = useState<File[]>(initialFiles ?? [])
  const [outcomes, setOutcomes] = useState<ExtractionOutcome[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 })
  const [saveResults, setSaveResults] = useState<SaveOutcome[]>([])
  const [error, setError] = useState<string | null>(null)

  const successes = outcomes.filter((o): o is Extract<ExtractionOutcome, { ok: true }> => o.ok)
  const failures = outcomes.filter((o): o is Extract<ExtractionOutcome, { ok: false }> => !o.ok)
  const currentOutcome = successes[currentIndex]

  // When attaching an upload to an existing tracked bill, we don't support batching.
  const singleBillMode = !!bill?.id

  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      handleUpload(initialFiles)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function uploadOne(file: File): Promise<ExtractionOutcome> {
    try {
      const formData = new FormData()
      formData.append('file', file)
      if (bill?.id) formData.append('bill_id', bill.id)

      const res = await fetch('/api/bills/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) {
        return { ok: false, fileName: file.name, error: data.error || 'Upload failed' }
      }
      return { ok: true, fileName: file.name, extraction: data.extraction }
    } catch {
      return { ok: false, fileName: file.name, error: 'Upload failed. Please try again.' }
    }
  }

  async function handleUpload(files: File[]) {
    setStage('uploading')
    setError(null)
    setUploadProgress({ done: 0, total: files.length })

    // Existing-bill mode: only the first file is used, matching prior behaviour.
    const toProcess = singleBillMode ? files.slice(0, 1) : files

    const collected: ExtractionOutcome[] = []
    for (const file of toProcess) {
      const outcome = await uploadOne(file)
      collected.push(outcome)
      setUploadProgress((p) => ({ ...p, done: p.done + 1 }))
    }

    const extracted = collected.filter((o) => o.ok)
    if (extracted.length === 0) {
      setError(collected[0] && !collected[0].ok ? collected[0].error : 'Extraction failed for all files')
      setOutcomes(collected)
      setStage('error')
      return
    }

    setOutcomes(collected)
    setCurrentIndex(0)
    setStage('review')
  }

  async function saveOne(extraction: ExtractionData, fileName: string): Promise<SaveOutcome> {
    try {
      const res = await fetch('/api/bills/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bill_id: bill?.id || null,
          extraction,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        return { fileName, providerName: extraction.provider, ok: false, error: data.error || 'Failed to save' }
      }
      return { fileName, providerName: extraction.provider, ok: true }
    } catch {
      return { fileName, providerName: extraction.provider, ok: false, error: 'Network error' }
    }
  }

  async function handleConfirm() {
    if (!currentOutcome) return
    setStage('saving')
    const result = await saveOne(currentOutcome.extraction, currentOutcome.fileName)
    const nextResults = [...saveResults, result]
    setSaveResults(nextResults)

    const isLast = currentIndex >= successes.length - 1
    if (isLast) {
      // For a single-bill flow attached to an existing bill, keep the previous
      // close-and-refresh behaviour so existing call sites don't change.
      if (singleBillMode && result.ok) {
        onConfirmed()
        return
      }
      setStage('summary')
    } else {
      setCurrentIndex((i) => i + 1)
      setStage('review')
    }
  }

  function handleSkipCurrent() {
    const isLast = currentIndex >= successes.length - 1
    if (isLast) {
      setStage('summary')
    } else {
      setCurrentIndex((i) => i + 1)
    }
  }

  function handleEditField(field: keyof ExtractionData, value: unknown) {
    if (!currentOutcome) return
    const updated: ExtractionData = { ...currentOutcome.extraction, [field]: value }
    setOutcomes((prev) => {
      const copy = [...prev]
      const successIdx = copy.findIndex((o) => o === currentOutcome)
      if (successIdx >= 0) {
        copy[successIdx] = { ...currentOutcome, extraction: updated }
      }
      return copy
    })
  }

  function finishSummary() {
    if (saveResults.some((r) => r.ok)) onConfirmed()
    else onClose()
  }

  const totalToReview = successes.length
  const showPagination = totalToReview > 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">
            {stage === 'review'
              ? showPagination
                ? `Bill ${currentIndex + 1} of ${totalToReview}`
                : 'Confirm bill details'
              : stage === 'summary'
                ? 'Upload summary'
                : 'Upload bills'}
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        <div className="p-4">
          {stage === 'select' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {singleBillMode
                  ? 'Upload a bill (PDF or image) for this provider to refresh plan details.'
                  : 'Upload one or more bills (PDF or image). Each file is treated as a separate bill.'}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple={!singleBillMode}
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
                    Extract bill details
                  </button>
                </div>
              )}
              <p className="text-xs text-muted-foreground text-center">
                Accepts PDF, PNG, JPG, HEIC
              </p>
            </div>
          )}

          {stage === 'uploading' && (
            <div className="flex flex-col items-center py-8 gap-3">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">
                Extracting bill details
                {uploadProgress.total > 1 ? ` (${uploadProgress.done}/${uploadProgress.total})` : ''}…
              </p>
            </div>
          )}

          {stage === 'review' && currentOutcome && (
            <div className="space-y-3">
              {showPagination && (
                <p className="text-xs text-muted-foreground">
                  From <span className="text-foreground">{currentOutcome.fileName}</span>
                </p>
              )}

              <div className={`text-xs px-2 py-1 rounded inline-block ${
                currentOutcome.extraction.confidence === 'high'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : currentOutcome.extraction.confidence === 'medium'
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'bg-red-500/10 text-red-600 dark:text-red-400'
              }`}>
                {currentOutcome.extraction.confidence} confidence extraction
              </div>

              <EditableRow label="Provider" value={currentOutcome.extraction.provider} onChange={(v) => handleEditField('provider', v)} />
              <EditableRow label="Amount" value={String(currentOutcome.extraction.total_amount)} onChange={(v) => handleEditField('total_amount', Number(v))} />
              <EditableRow label="Currency" value={currentOutcome.extraction.currency} onChange={(v) => handleEditField('currency', v)} />

              {currentOutcome.extraction.billing_period && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Period: </span>
                  <span className="text-foreground">
                    {currentOutcome.extraction.billing_period.start} to {currentOutcome.extraction.billing_period.end}
                  </span>
                </div>
              )}

              {currentOutcome.extraction.consumption_kwh != null && (
                <EditableRow label="Consumption (kWh)" value={String(currentOutcome.extraction.consumption_kwh)} onChange={(v) => handleEditField('consumption_kwh', Number(v))} />
              )}
              {currentOutcome.extraction.consumption_m3 != null && (
                <EditableRow label="Consumption (m³)" value={String(currentOutcome.extraction.consumption_m3)} onChange={(v) => handleEditField('consumption_m3', Number(v))} />
              )}
              {currentOutcome.extraction.tariff_type && (
                <EditableRow label="Tariff" value={currentOutcome.extraction.tariff_type} onChange={(v) => handleEditField('tariff_type', v)} />
              )}
              {currentOutcome.extraction.power_contracted_kw != null && (
                <EditableRow label="Contracted power (kW)" value={String(currentOutcome.extraction.power_contracted_kw)} onChange={(v) => handleEditField('power_contracted_kw', Number(v))} />
              )}
              {currentOutcome.extraction.plan_name && (
                <EditableRow label="Plan" value={currentOutcome.extraction.plan_name} onChange={(v) => handleEditField('plan_name', v)} />
              )}
              {currentOutcome.extraction.speed_mbps != null && (
                <EditableRow label="Speed (Mbps)" value={String(currentOutcome.extraction.speed_mbps)} onChange={(v) => handleEditField('speed_mbps', Number(v))} />
              )}
              {currentOutcome.extraction.contract_end_date && (
                <EditableRow label="Contract ends" value={currentOutcome.extraction.contract_end_date} onChange={(v) => handleEditField('contract_end_date', v)} />
              )}
              {currentOutcome.extraction.has_permanencia && (
                <div className="text-sm">
                  <span className="text-amber-600 dark:text-amber-400">Has lock-in period (permanencia)</span>
                </div>
              )}

              <div className="flex gap-2 pt-3">
                <button
                  onClick={handleConfirm}
                  className="flex-1 bg-primary text-primary-foreground text-sm font-medium rounded-lg py-2.5 min-h-[44px] hover:bg-primary/90 transition-colors"
                >
                  {showPagination && currentIndex < totalToReview - 1 ? 'Save & next' : 'Confirm & save'}
                </button>
                {showPagination ? (
                  <button
                    onClick={handleSkipCurrent}
                    className="px-4 text-sm text-muted-foreground hover:text-foreground min-h-[44px] transition-colors"
                  >
                    Skip
                  </button>
                ) : (
                  <button
                    onClick={onClose}
                    className="px-4 text-sm text-muted-foreground hover:text-foreground min-h-[44px] transition-colors"
                  >
                    Discard
                  </button>
                )}
              </div>
            </div>
          )}

          {stage === 'saving' && (
            <div className="flex flex-col items-center py-8 gap-3">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">Saving…</p>
            </div>
          )}

          {stage === 'summary' && (
            <div className="space-y-4">
              <div className="space-y-2">
                {saveResults.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <span className={r.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                      {r.ok ? '✓' : '✗'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-foreground truncate">{r.providerName || r.fileName}</div>
                      {!r.ok && r.error && (
                        <div className="text-xs text-red-600 dark:text-red-400">{r.error}</div>
                      )}
                    </div>
                  </div>
                ))}
                {failures.map((f, i) => (
                  <div key={`f-${i}`} className="flex items-start gap-2 text-sm">
                    <span className="text-red-600 dark:text-red-400">✗</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-foreground truncate">{f.fileName}</div>
                      <div className="text-xs text-red-600 dark:text-red-400">{f.error}</div>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={finishSummary}
                className="w-full bg-primary text-primary-foreground text-sm font-medium rounded-lg py-2.5 min-h-[44px] hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            </div>
          )}

          {stage === 'error' && (
            <div className="space-y-4">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              <button
                onClick={() => { setStage('select'); setSelectedFiles([]); setOutcomes([]) }}
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
