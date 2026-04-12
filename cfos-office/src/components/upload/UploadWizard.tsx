'use client'

import { useState } from 'react'
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
  | { step: 'error'; message: string }

type Props = {
  categories: Category[]
  onImported: () => void
  onDone?: () => void
  /** 'transactions' (default) or 'balance_sheet'. */
  context?: 'transactions' | 'balance_sheet'
}

export function UploadWizard({ categories, onImported, onDone, context = 'transactions' }: Props) {
  const trackEvent = useTrackEvent()
  const [state, setState] = useState<WizardState>({ step: 'idle' })

  async function handleFile(file: File) {
    // Client-side validation
    const MAX_FILE_SIZE = 10 * 1024 * 1024
    if (file.size > MAX_FILE_SIZE) {
      setState({ step: 'error', message: 'File too large. Maximum size is 10MB.' })
      return
    }
    const ext = file.name.toLowerCase().split('.').pop()
    const ALLOWED_EXTS = new Set([
      'csv',
      'xlsx',
      'xls',
      'png',
      'jpg',
      'jpeg',
      'heic',
      'webp',
      'pdf',
    ])
    if (!ext || !ALLOWED_EXTS.has(ext)) {
      setState({ step: 'error', message: 'Unsupported file type.' })
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
        setState({ step: 'error', message: data.error ?? 'Upload failed' })
        return
      }

      // Balance sheet: holdings CSV
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

      // Balance sheet: screenshot
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

      // Balance sheet: PDF
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
        setState({ step: 'mapping', headers: data.headers, autoMapping: data.autoMapping, rawRows: data.rawRows })
        return
      }

      setState({ step: 'preview', preview: data.preview, importBatchId: data.importBatchId })
    } catch {
      trackEvent('upload_failed', { file_type: fileType, error: 'Network error' })
      setState({ step: 'error', message: 'Network error. Please try again.' })
    }
  }

  async function handleMappingConfirm(mapping: Record<string, string>) {
    if (state.step !== 'mapping') return
    const { rawRows } = state
    setState({ step: 'uploading' })
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply-mapping', rawRows, mapping }),
      })
      const data = await res.json()
      if (!res.ok) {
        setState({ step: 'error', message: data.error ?? 'Mapping failed' })
        return
      }
      setState({ step: 'preview', preview: data.preview, importBatchId: data.importBatchId })
    } catch {
      setState({ step: 'error', message: 'Network error. Please try again.' })
    }
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
        setState({ step: 'error', message: data.error ?? 'Import failed' })
        return
      }
      trackEvent('upload_completed', { file_type: 'csv', transaction_count: data.imported })
      setState({ step: 'done', imported: data.imported, duplicates: data.duplicates, errors: data.errors, importBatchId })
      onImported()
    } catch {
      setState({ step: 'error', message: 'Network error. Please try again.' })
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
        setState({ step: 'error', message: data.error ?? 'Balance sheet import failed' })
        return
      }
      trackEvent('upload_completed', {
        file_type: 'balance_sheet',
        transaction_count: (data.holdings_created ?? 0) + (data.holdings_updated ?? 0),
      })
      setState({
        step: 'balance_sheet_done',
        summary: {
          assets_created: data.assets_created ?? 0,
          assets_updated: data.assets_updated ?? 0,
          liabilities_created: data.liabilities_created ?? 0,
          liabilities_updated: data.liabilities_updated ?? 0,
          holdings_created: data.holdings_created ?? 0,
          holdings_updated: data.holdings_updated ?? 0,
        },
      })
      onImported()
    } catch {
      setState({ step: 'error', message: 'Network error. Please try again.' })
    }
  }

  function reset() {
    setState({ step: 'idle' })
  }

  if (state.step === 'idle') {
    return <UploadZone onFile={handleFile} context={context} />
  }

  if (state.step === 'uploading') {
    return <UploadZone onFile={handleFile} isLoading context={context} />
  }

  if (state.step === 'balance_sheet_preview') {
    return (
      <HoldingsPreview
        holdings={state.holdings}
        screenshotData={state.screenshotData}
        suggestedAssetName={state.suggestedAssetName}
        suggestedProvider={state.suggestedProvider}
        source={state.source}
        onConfirm={handleBalanceSheetConfirm}
        onCancel={reset}
      />
    )
  }

  if (state.step === 'balance_sheet_importing') {
    return (
      <div className="text-center py-6 text-sm text-muted-foreground">Saving to your balance sheet…</div>
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
          onClick={onDone ?? reset}
          className="rounded-md border border-input px-4 py-2 text-sm min-h-[44px]"
        >
          Done
        </button>
      </div>
    )
  }

  if (state.step === 'mapping') {
    return (
      <ColumnMapper
        headers={state.headers}
        autoMapping={state.autoMapping}
        onConfirm={handleMappingConfirm}
        onCancel={reset}
      />
    )
  }

  if (state.step === 'preview') {
    return (
      <TransactionPreview
        transactions={state.preview}
        categories={categories}
        onConfirm={handleImportConfirm}
        onCancel={reset}
      />
    )
  }

  if (state.step === 'importing') {
    return (
      <TransactionPreview
        transactions={[]}
        categories={[]}
        onConfirm={() => {}}
        onCancel={() => {}}
        isImporting
      />
    )
  }

  if (state.step === 'done') {
    return (
      <ImportResult
        imported={state.imported}
        duplicates={state.duplicates}
        errors={state.errors}
        importBatchId={state.importBatchId}
        onDone={onDone ?? reset}
      />
    )
  }

  if (state.step === 'error') {
    return (
      <div className="text-center space-y-3 py-6">
        <p className="text-destructive text-sm">{state.message}</p>
        <button
          onClick={reset}
          className="rounded-md border border-input px-4 py-2 text-sm min-h-[44px]"
        >
          Try again
        </button>
      </div>
    )
  }

  return null
}
