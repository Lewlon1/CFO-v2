'use client'

import { useState } from 'react'
import { UploadZone } from './UploadZone'
import { ColumnMapper } from './ColumnMapper'
import { TransactionPreview } from './TransactionPreview'
import { ImportResult } from './ImportResult'
import type { PreviewTransaction, Category } from '@/lib/parsers/types'

type WizardState =
  | { step: 'idle' }
  | { step: 'uploading' }
  | { step: 'mapping'; headers: string[]; autoMapping: Record<string, string>; rawRows: Record<string, string>[] }
  | { step: 'preview'; preview: PreviewTransaction[]; importBatchId: string }
  | { step: 'importing' }
  | { step: 'done'; imported: number; duplicates: number; errors: number; importBatchId: string }
  | { step: 'error'; message: string }

type Props = {
  categories: Category[]
  onImported: () => void
  onDone?: () => void
}

export function UploadWizard({ categories, onImported, onDone }: Props) {
  const [state, setState] = useState<WizardState>({ step: 'idle' })

  async function handleFile(file: File) {
    // Client-side validation
    const MAX_FILE_SIZE = 10 * 1024 * 1024
    if (file.size > MAX_FILE_SIZE) {
      setState({ step: 'error', message: 'File too large. Maximum size is 10MB.' })
      return
    }
    const ext = file.name.toLowerCase().split('.').pop()
    const ALLOWED_EXTS = new Set(['csv', 'xlsx', 'xls', 'png', 'jpg', 'jpeg', 'heic', 'webp'])
    if (!ext || !ALLOWED_EXTS.has(ext)) {
      setState({ step: 'error', message: 'Unsupported file type. We accept CSV, Excel, and screenshot images.' })
      return
    }

    setState({ step: 'uploading' })
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()

      if (!res.ok) {
        setState({ step: 'error', message: data.error ?? 'Upload failed' })
        return
      }

      if (data.needsColumnMapping) {
        setState({ step: 'mapping', headers: data.headers, autoMapping: data.autoMapping, rawRows: data.rawRows })
        return
      }

      setState({ step: 'preview', preview: data.preview, importBatchId: data.importBatchId })
    } catch {
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
    rows: Array<PreviewTransaction & { categoryId: string | null; valueCategory: string }>
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
      setState({ step: 'done', imported: data.imported, duplicates: data.duplicates, errors: data.errors, importBatchId })
      onImported()
    } catch {
      setState({ step: 'error', message: 'Network error. Please try again.' })
    }
  }

  function reset() {
    setState({ step: 'idle' })
  }

  if (state.step === 'idle') {
    return <UploadZone onFile={handleFile} />
  }

  if (state.step === 'uploading') {
    return <UploadZone onFile={handleFile} isLoading />
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
