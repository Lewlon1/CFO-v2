'use client'

import { useState, useEffect, useRef } from 'react'
import { useTrackEvent } from '@/lib/events/use-track-event'
import { UploadZone } from './UploadZone'
import { ColumnMapper } from './ColumnMapper'
import { TransactionPreview } from './TransactionPreview'
import { HoldingsPreview } from './HoldingsPreview'
import { ImportResult } from './ImportResult'
import type { PreviewTransaction, Category, ParsedHolding } from '@/lib/parsers/types'
import type {
  ConfirmedBalanceSheetImport,
  BalanceSheetSource,
} from '@/lib/upload/balance-sheet-import'

// Screenshot/PDF extraction shape returned by the upload route.
type BalanceSheetExtraction = {
  document_type:
    | 'investment_holdings'
    | 'pension_statement'
    | 'loan_statement'
    | 'savings_statement'
    | 'credit_card_statement'
    | 'unknown'
  provider: string | null
  account_name: string | null
  currency: string
  holdings: Array<{
    name: string
    ticker: string | null
    quantity: number | null
    current_value: number | null
    cost_basis: number | null
    gain_loss_pct: number | null
  }>
  balance: {
    outstanding_balance: number | null
    interest_rate: number | null
    credit_limit: number | null
    minimum_payment: number | null
    monthly_payment: number | null
    remaining_term: string | null
  }
  total_value: number | null
  confidence: 'high' | 'medium' | 'low'
}

type WizardState =
  | { step: 'idle' }
  | { step: 'uploading' }
  | { step: 'mapping'; headers: string[]; autoMapping: Record<string, string>; rawRows: Record<string, string>[] }
  | { step: 'preview'; preview: PreviewTransaction[]; importBatchId: string }
  | {
      step: 'balance_sheet_preview'
      holdings?: ParsedHolding[]
      screenshotData?: BalanceSheetExtraction
      suggestedAssetName: string | null
      suggestedProvider: string | null
      source: BalanceSheetSource
    }
  | { step: 'importing' }
  | { step: 'balance_sheet_importing' }
  | { step: 'done'; imported: number; duplicates: number; errors: number; importBatchId: string }
  | { step: 'balance_sheet_done'; summary: { assets_created: number; assets_updated: number; liabilities_created: number; liabilities_updated: number; holdings_created: number; holdings_updated: number } }
  | { step: 'batch_done' }
  | { step: 'error'; message: string }

type BatchResult = {
  fileName: string
  ok: boolean
  kind: 'transactions' | 'balance_sheet' | 'error'
  imported?: number
  duplicates?: number
  errors?: number
  balanceSheet?: {
    assets_created: number
    assets_updated: number
    liabilities_created: number
    liabilities_updated: number
    holdings_created: number
    holdings_updated: number
  }
  error?: string
}

type Props = {
  categories: Category[]
  onImported: (importBatchId?: string, count?: number) => void
  onDone?: () => void
  /** 'transactions' (default) or 'balance_sheet'. */
  context?: 'transactions' | 'balance_sheet'
  /** When true, skip review and auto-import after upload. */
  autoImport?: boolean
}

function headersKey(headers: string[] | undefined | null): string {
  if (!headers || headers.length === 0) return ''
  return headers.map((h) => h.trim().toLowerCase()).join('|')
}

export function UploadWizard({ categories, onImported, onDone, context = 'transactions', autoImport }: Props) {
  const trackEvent = useTrackEvent()
  const [state, setState] = useState<WizardState>({ step: 'idle' })
  const autoImportFiredRef = useRef(false)

  // Batch coordination — use refs for the source of truth so closures across
  // async `await` boundaries always see the latest values. Mirror to state only
  // for UI rendering (file counter, batch summary).
  const queueRef = useRef<File[]>([])
  const currentFileRef = useRef<File | null>(null)
  const totalFilesRef = useRef(0)
  const completedFilesRef = useRef(0)
  const [queue, setQueue] = useState<File[]>([])
  const [currentFile, setCurrentFile] = useState<File | null>(null)
  const [totalFiles, setTotalFiles] = useState(0)
  const [completedFiles, setCompletedFiles] = useState(0)
  const [batchResults, setBatchResults] = useState<BatchResult[]>([])
  const cachedMappingRef = useRef<{ key: string; mapping: Record<string, string> } | null>(null)

  function updateQueue(next: File[]) {
    queueRef.current = next
    setQueue(next)
  }
  function updateCurrentFile(next: File | null) {
    currentFileRef.current = next
    setCurrentFile(next)
  }
  function updateTotalFiles(next: number) {
    totalFilesRef.current = next
    setTotalFiles(next)
  }
  function incrementCompletedFiles() {
    completedFilesRef.current += 1
    setCompletedFiles(completedFilesRef.current)
  }

  function resetBatch() {
    autoImportFiredRef.current = false
    cachedMappingRef.current = null
    completedFilesRef.current = 0
    updateQueue([])
    updateCurrentFile(null)
    updateTotalFiles(0)
    setCompletedFiles(0)
    setBatchResults([])
    setState({ step: 'idle' })
  }

  async function handleFiles(files: File[]) {
    if (files.length === 0) return
    // Begin a fresh batch
    autoImportFiredRef.current = false
    cachedMappingRef.current = null
    completedFilesRef.current = 0
    setBatchResults([])
    setCompletedFiles(0)
    updateTotalFiles(files.length)
    const [first, ...rest] = files
    updateQueue(rest)
    updateCurrentFile(first)
    await processFile(first)
  }

  function recordResult(partial: BatchResult) {
    setBatchResults((prev) => [...prev, partial])
    if (!partial.ok) {
      console.warn('[upload-wizard] file failed:', partial.fileName, partial.error)
    }
  }

  async function advanceOrFinish() {
    incrementCompletedFiles()
    if (queueRef.current.length === 0) {
      // Final file done. For a single-file batch, don't show the batch summary —
      // the existing per-file 'done' UI is already rendered by the render function.
      if (totalFilesRef.current <= 1) return
      // Multi-file autoImport: skip the batch summary and signal completion immediately
      if (autoImport && onDone) {
        onDone()
        return
      }
      setState({ step: 'batch_done' })
      return
    }
    const [next, ...rest] = queueRef.current
    updateQueue(rest)
    updateCurrentFile(next)
    autoImportFiredRef.current = false
    await processFile(next)
  }

  async function processFile(file: File) {
    // Client-side validation
    const MAX_FILE_SIZE = 10 * 1024 * 1024
    if (file.size > MAX_FILE_SIZE) {
      recordResult({ fileName: file.name, ok: false, kind: 'error', error: 'File too large (max 10MB).' })
      await advanceOrFinish()
      return
    }
    const ext = file.name.toLowerCase().split('.').pop()
    const ALLOWED_EXTS = new Set(['csv', 'xlsx', 'xls', 'png', 'jpg', 'jpeg', 'heic', 'webp', 'pdf'])
    if (!ext || !ALLOWED_EXTS.has(ext)) {
      recordResult({ fileName: file.name, ok: false, kind: 'error', error: 'Unsupported file type.' })
      await advanceOrFinish()
      return
    }

    const fileType = ext ?? 'unknown'
    trackEvent('upload_started', { file_type: fileType })
    setState({ step: 'uploading' })
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('upload_context', context)
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()

      if (!res.ok) {
        trackEvent('upload_failed', { file_type: fileType, error: data.error ?? 'Upload failed' })
        recordResult({ fileName: file.name, ok: false, kind: 'error', error: data.error ?? 'Upload failed' })
        // In a batch, keep going; otherwise show the error UI
        if (totalFilesRef.current > 1) {
          await advanceOrFinish()
        } else {
          setState({ step: 'error', message: data.error ?? 'Upload failed' })
        }
        return
      }

      if (data.type === 'holdings') {
        setState({
          step: 'balance_sheet_preview',
          holdings: data.holdings,
          suggestedAssetName: data.suggestedAssetName,
          suggestedProvider: data.suggestedProvider,
          source: 'csv_upload',
        })
        return
      }

      if (data.type === 'balance_sheet_screenshot') {
        setState({
          step: 'balance_sheet_preview',
          screenshotData: data.data,
          suggestedAssetName: data.suggestedAssetName,
          suggestedProvider: data.suggestedProvider,
          source: 'screenshot',
        })
        return
      }

      if (data.type === 'balance_sheet_pdf') {
        setState({
          step: 'balance_sheet_preview',
          screenshotData: data.data,
          suggestedAssetName: data.suggestedAssetName,
          suggestedProvider: data.suggestedProvider,
          source: 'pdf',
        })
        return
      }

      if (data.needsColumnMapping) {
        const key = headersKey(data.headers)
        const cached = cachedMappingRef.current
        if (cached && cached.key === key) {
          // Re-use the mapping from the first file in this batch
          await applyMappingAndPreview(data.rawRows, cached.mapping)
          return
        }
        setState({ step: 'mapping', headers: data.headers, autoMapping: data.autoMapping, rawRows: data.rawRows })
        return
      }

      setState({ step: 'preview', preview: data.preview, importBatchId: data.importBatchId })
    } catch {
      trackEvent('upload_failed', { file_type: fileType, error: 'Network error' })
      recordResult({ fileName: file.name, ok: false, kind: 'error', error: 'Network error' })
      if (totalFilesRef.current > 1) {
        await advanceOrFinish()
      } else {
        setState({ step: 'error', message: 'Network error. Please try again.' })
      }
    }
  }

  async function applyMappingAndPreview(rawRows: Record<string, string>[], mapping: Record<string, string>) {
    setState({ step: 'uploading' })
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply-mapping', rawRows, mapping }),
      })
      const data = await res.json()
      if (!res.ok) {
        const msg = data.error ?? 'Mapping failed'
        recordResult({ fileName: currentFile?.name ?? 'file', ok: false, kind: 'error', error: msg })
        if (totalFilesRef.current > 1) {
          await advanceOrFinish()
        } else {
          setState({ step: 'error', message: msg })
        }
        return
      }
      setState({ step: 'preview', preview: data.preview, importBatchId: data.importBatchId })
    } catch {
      recordResult({ fileName: currentFile?.name ?? 'file', ok: false, kind: 'error', error: 'Network error' })
      if (totalFilesRef.current > 1) {
        await advanceOrFinish()
      } else {
        setState({ step: 'error', message: 'Network error. Please try again.' })
      }
    }
  }

  async function handleMappingConfirm(mapping: Record<string, string>) {
    if (state.step !== 'mapping') return
    const { rawRows, headers } = state
    cachedMappingRef.current = { key: headersKey(headers), mapping }
    await applyMappingAndPreview(rawRows, mapping)
  }

  async function handleImportConfirm(
    rows: Array<PreviewTransaction & { categoryId: string | null }>
  ) {
    if (state.step !== 'preview') return
    const { importBatchId } = state
    setState({ step: 'importing' })
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import', transactions: rows, importBatchId }),
      })
      const data = await res.json()
      if (!res.ok) {
        const msg = data.error ?? 'Import failed'
        recordResult({ fileName: currentFile?.name ?? 'file', ok: false, kind: 'error', error: msg })
        if (totalFilesRef.current > 1) {
          await advanceOrFinish()
        } else {
          setState({ step: 'error', message: msg })
        }
        return
      }
      trackEvent('upload_completed', { file_type: 'csv', transaction_count: data.imported })
      recordResult({
        fileName: currentFile?.name ?? 'file',
        ok: true,
        kind: 'transactions',
        imported: data.imported,
        duplicates: data.duplicates,
        errors: data.errors,
      })
      onImported(importBatchId, data.imported)

      if (totalFilesRef.current > 1) {
        await advanceOrFinish()
      } else if (autoImport && onDone) {
        // Single-file autoImport: skip the done screen and signal completion immediately
        onDone()
      } else {
        setState({ step: 'done', imported: data.imported, duplicates: data.duplicates, errors: data.errors, importBatchId })
      }
    } catch {
      recordResult({ fileName: currentFile?.name ?? 'file', ok: false, kind: 'error', error: 'Network error' })
      if (totalFilesRef.current > 1) {
        await advanceOrFinish()
      } else {
        setState({ step: 'error', message: 'Network error. Please try again.' })
      }
    }
  }

  async function handleBalanceSheetConfirm(payload: ConfirmedBalanceSheetImport) {
    setState({ step: 'balance_sheet_importing' })
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import-balance-sheet', data: payload }),
      })
      const data = await res.json()
      if (!res.ok) {
        const msg = data.error ?? 'Balance sheet import failed'
        recordResult({ fileName: currentFile?.name ?? 'file', ok: false, kind: 'error', error: msg })
        if (totalFilesRef.current > 1) {
          await advanceOrFinish()
        } else {
          setState({ step: 'error', message: msg })
        }
        return
      }
      trackEvent('upload_completed', {
        file_type: 'balance_sheet',
        transaction_count: (data.holdings_created ?? 0) + (data.holdings_updated ?? 0),
      })
      const summary = {
        assets_created: data.assets_created ?? 0,
        assets_updated: data.assets_updated ?? 0,
        liabilities_created: data.liabilities_created ?? 0,
        liabilities_updated: data.liabilities_updated ?? 0,
        holdings_created: data.holdings_created ?? 0,
        holdings_updated: data.holdings_updated ?? 0,
      }
      recordResult({
        fileName: currentFile?.name ?? 'file',
        ok: true,
        kind: 'balance_sheet',
        balanceSheet: summary,
      })
      onImported()

      if (totalFilesRef.current > 1) {
        await advanceOrFinish()
      } else {
        setState({ step: 'balance_sheet_done', summary })
      }
    } catch {
      recordResult({ fileName: currentFile?.name ?? 'file', ok: false, kind: 'error', error: 'Network error' })
      if (totalFilesRef.current > 1) {
        await advanceOrFinish()
      } else {
        setState({ step: 'error', message: 'Network error. Please try again.' })
      }
    }
  }

  // Auto-import: when autoImport is true and the wizard reaches 'preview',
  // fire the import exactly once via an effect (never during render).
  useEffect(() => {
    if (state.step === 'preview' && autoImport && !autoImportFiredRef.current) {
      autoImportFiredRef.current = true
      const rows = state.preview.map((tx) => ({ ...tx, categoryId: tx.suggestedCategoryId ?? null }))
      handleImportConfirm(rows)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, autoImport])

  // Batch banner shown above per-file stages
  const batchBanner =
    totalFiles > 1 && state.step !== 'batch_done' && state.step !== 'idle' ? (
      <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground mb-3">
        File {Math.min(completedFiles + 1, totalFiles)} of {totalFiles}
        {currentFile ? <> — <span className="text-foreground">{currentFile.name}</span></> : null}
      </div>
    ) : null

  if (state.step === 'idle') {
    return <UploadZone onFiles={handleFiles} context={context} />
  }

  if (state.step === 'uploading') {
    return (
      <div>
        {batchBanner}
        <UploadZone onFiles={handleFiles} isLoading context={context} />
      </div>
    )
  }

  if (state.step === 'balance_sheet_preview') {
    return (
      <div>
        {batchBanner}
        <HoldingsPreview
          holdings={state.holdings}
          screenshotData={state.screenshotData}
          suggestedAssetName={state.suggestedAssetName}
          suggestedProvider={state.suggestedProvider}
          source={state.source}
          onConfirm={handleBalanceSheetConfirm}
          onCancel={resetBatch}
        />
      </div>
    )
  }

  if (state.step === 'balance_sheet_importing') {
    return (
      <div>
        {batchBanner}
        <div className="text-center py-6 text-sm text-muted-foreground">Saving to your balance sheet…</div>
      </div>
    )
  }

  if (state.step === 'balance_sheet_done') {
    const s = state.summary
    const bits: string[] = []
    if (s.assets_created) bits.push(`${s.assets_created} new asset${s.assets_created === 1 ? '' : 's'}`)
    if (s.assets_updated) bits.push(`${s.assets_updated} updated`)
    if (s.holdings_created) bits.push(`${s.holdings_created} holding${s.holdings_created === 1 ? '' : 's'} added`)
    if (s.holdings_updated) bits.push(`${s.holdings_updated} holding${s.holdings_updated === 1 ? '' : 's'} updated`)
    if (s.liabilities_created) bits.push(`${s.liabilities_created} new debt${s.liabilities_created === 1 ? '' : 's'}`)
    if (s.liabilities_updated) bits.push(`${s.liabilities_updated} debt${s.liabilities_updated === 1 ? '' : 's'} updated`)
    return (
      <div className="text-center space-y-3 py-6">
        <div className="text-2xl">✅</div>
        <p className="text-sm text-foreground">Saved — {bits.join(', ') || 'nothing changed'}.</p>
        <button
          onClick={onDone ?? resetBatch}
          className="rounded-md border border-input px-4 py-2 text-sm min-h-[44px]"
        >
          Done
        </button>
      </div>
    )
  }

  if (state.step === 'mapping') {
    return (
      <div>
        {batchBanner}
        <ColumnMapper
          headers={state.headers}
          autoMapping={state.autoMapping}
          onConfirm={handleMappingConfirm}
          onCancel={resetBatch}
        />
      </div>
    )
  }

  if (state.step === 'preview') {
    if (autoImport) {
      return (
        <div>
          {batchBanner}
          <UploadZone onFiles={handleFiles} isLoading context={context} />
        </div>
      )
    }
    return (
      <div>
        {batchBanner}
        <TransactionPreview
          transactions={state.preview}
          categories={categories}
          onConfirm={handleImportConfirm}
          onCancel={resetBatch}
        />
      </div>
    )
  }

  if (state.step === 'importing') {
    return (
      <div>
        {batchBanner}
        <UploadZone onFiles={handleFiles} isLoading context={context} />
      </div>
    )
  }

  if (state.step === 'done') {
    return (
      <ImportResult
        imported={state.imported}
        duplicates={state.duplicates}
        errors={state.errors}
        importBatchId={state.importBatchId}
        onDone={onDone ?? resetBatch}
      />
    )
  }

  if (state.step === 'batch_done') {
    return <BatchSummary results={batchResults} onDone={onDone ?? resetBatch} />
  }

  if (state.step === 'error') {
    return (
      <div className="text-center space-y-3 py-6">
        <p className="text-destructive text-sm">{state.message}</p>
        <button
          onClick={resetBatch}
          className="rounded-md border border-input px-4 py-2 text-sm min-h-[44px]"
        >
          Try again
        </button>
      </div>
    )
  }

  return null
}

function BatchSummary({ results, onDone }: { results: BatchResult[]; onDone: () => void }) {
  const succeeded = results.filter((r) => r.ok)
  const failed = results.filter((r) => !r.ok)

  return (
    <div className="space-y-4 py-4">
      <div className="text-center">
        <div className="text-2xl">✅</div>
        <p className="text-sm text-foreground mt-1">
          Imported {succeeded.length} of {results.length} file{results.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="space-y-2">
        {results.map((r, i) => (
          <div key={i} className="flex items-start gap-2 text-sm border-b border-border pb-2 last:border-0">
            <span className={r.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
              {r.ok ? '✓' : '✗'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-foreground truncate">{r.fileName}</div>
              {r.ok && r.kind === 'transactions' && (
                <div className="text-xs text-muted-foreground">
                  {r.imported} imported
                  {r.duplicates ? `, ${r.duplicates} duplicate${r.duplicates === 1 ? '' : 's'}` : ''}
                  {r.errors ? `, ${r.errors} error${r.errors === 1 ? '' : 's'}` : ''}
                </div>
              )}
              {r.ok && r.kind === 'balance_sheet' && r.balanceSheet && (
                <div className="text-xs text-muted-foreground">
                  {summariseBalanceSheet(r.balanceSheet)}
                </div>
              )}
              {!r.ok && r.error && (
                <div className="text-xs text-red-600 dark:text-red-400">{r.error}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {failed.length > 0 && failed.length < results.length && (
        <p className="text-xs text-muted-foreground text-center">
          Successful imports are saved — you can retry the failed files separately.
        </p>
      )}

      <button
        onClick={onDone}
        className="w-full rounded-md border border-input px-4 py-2 text-sm min-h-[44px]"
      >
        Done
      </button>
    </div>
  )
}

function summariseBalanceSheet(s: NonNullable<BatchResult['balanceSheet']>) {
  const bits: string[] = []
  if (s.assets_created) bits.push(`${s.assets_created} new asset${s.assets_created === 1 ? '' : 's'}`)
  if (s.assets_updated) bits.push(`${s.assets_updated} updated`)
  if (s.holdings_created) bits.push(`${s.holdings_created} holding${s.holdings_created === 1 ? '' : 's'} added`)
  if (s.holdings_updated) bits.push(`${s.holdings_updated} updated`)
  if (s.liabilities_created) bits.push(`${s.liabilities_created} new debt${s.liabilities_created === 1 ? '' : 's'}`)
  if (s.liabilities_updated) bits.push(`${s.liabilities_updated} updated`)
  return bits.join(', ') || 'no changes'
}
