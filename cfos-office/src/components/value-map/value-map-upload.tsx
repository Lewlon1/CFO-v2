'use client'

import { useState, useRef } from 'react'
import Papa from 'papaparse'
import { Upload, Camera, Sparkles, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { detectColumnMapping, isMappingHighConfidence } from '@/lib/csv/column-detector'
import { transformRow } from '@/lib/csv/transform'
import { selectTransactions } from '@/lib/value-map/selection'
import { SAMPLE_TRANSACTIONS } from '@/lib/value-map/constants'
import type { ValueMapTransaction } from '@/lib/value-map/types'
import { cn } from '@/lib/utils'

interface ValueMapUploadProps {
  currency: string
  onTransactionsReady: (transactions: ValueMapTransaction[], isRealData: boolean) => void
}

export function ValueMapUpload({ currency, onTransactionsReady }: ValueMapUploadProps) {
  const csvInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingLabel, setProcessingLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [csvDragging, setCsvDragging] = useState(false)

  // ── CSV handling ─────────────────────────────────────────────────────────

  function handleCsvFile(file: File) {
    if (!file.name.match(/\.(csv|tsv)$/i)) {
      setError('Please upload a .csv or .tsv file.')
      return
    }
    setError(null)
    setIsProcessing(true)
    setProcessingLabel('Reading your transactions...')

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      delimiter: file.name.endsWith('.tsv') ? '\t' : '',
      complete: (result) => {
        if (!result.data.length) {
          setError('The file appears to be empty.')
          setIsProcessing(false)
          return
        }

        const headers = Object.keys(result.data[0])
        const mapping = detectColumnMapping(headers)

        if (!isMappingHighConfidence(mapping)) {
          setError(
            'Could not detect date, amount, and merchant/description columns. Check your CSV format.',
          )
          setIsProcessing(false)
          return
        }

        const transformed = result.data
          .map((row) => transformRow(row, mapping, currency))
          .filter((r) => !r.parseError && r.type === 'expense')

        const transactions: ValueMapTransaction[] = transformed.map((r, i) => ({
          id: `csv-${i}`,
          merchant: r.merchant,
          description: r.description,
          amount: r.amount,
          currency: r.currency,
          transaction_date: r.transaction_date,
          is_recurring: false,
          category_name: r.raw_category ?? null,
        }))

        const selected = selectTransactions(transactions)
        if (selected.length === 0) {
          setError(
            `Found ${transactions.length} transactions, but not enough above ${currency === 'GBP' ? '\u00A3' : currency === 'EUR' ? '\u20AC' : '$'}10. Try with example data instead.`,
          )
          setIsProcessing(false)
          return
        }

        setProcessingLabel(`Found ${transactions.length} transactions. Selected ${selected.length} for your Value Map.`)
        setTimeout(() => {
          setIsProcessing(false)
          onTransactionsReady(selected, true)
        }, 800)
      },
      error: (err) => {
        setError(`Parse error: ${err.message}`)
        setIsProcessing(false)
      },
    })
  }

  // ── Screenshot/OCR handling ──────────────────────────────────────────────

  async function handleImageFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file (JPG, PNG, or HEIC).')
      return
    }

    setError(null)
    setIsProcessing(true)
    setProcessingLabel('Reading your bank statement...')

    try {
      const formData = new FormData()
      formData.append('image', file)
      formData.append('currency', currency)

      const res = await fetch('/api/value-map/extract', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'OCR failed' }))
        throw new Error(body.error ?? 'Failed to extract transactions from image.')
      }

      const data = await res.json() as {
        transactions: Array<{
          merchant: string
          amount: number
          date: string
          description: string | null
        }>
        confidence: 'high' | 'medium' | 'low'
      }

      if (!data.transactions.length) {
        setError('Could not find any transactions in the image. Try a clearer screenshot or use CSV instead.')
        setIsProcessing(false)
        return
      }

      if (data.confidence === 'low') {
        setError('The image quality was too low to read reliably. Try a clearer screenshot or use CSV instead.')
        setIsProcessing(false)
        return
      }

      const transactions: ValueMapTransaction[] = data.transactions.map((t, i) => ({
        id: `ocr-${i}`,
        merchant: t.merchant,
        description: t.description,
        amount: t.amount,
        currency,
        transaction_date: t.date,
        is_recurring: false,
        category_name: null,
      }))

      const selected = selectTransactions(transactions)
      if (selected.length === 0) {
        setError(
          `Found ${transactions.length} transactions, but not enough above ${currency === 'GBP' ? '\u00A3' : currency === 'EUR' ? '\u20AC' : '$'}10. Try with example data instead.`,
        )
        setIsProcessing(false)
        return
      }

      setProcessingLabel(`Found ${data.transactions.length} transactions. Selected ${selected.length} for your Value Map.`)
      setTimeout(() => {
        setIsProcessing(false)
        onTransactionsReady(selected, true)
      }, 800)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong reading the image.')
      setIsProcessing(false)
    }
  }

  // ── Sample data ──────────────────────────────────────────────────────────

  function handleSampleData() {
    const selected = selectTransactions(SAMPLE_TRANSACTIONS)
    onTransactionsReady(selected, false)
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (isProcessing) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 px-6 py-20">
        <Loader2 className="h-8 w-8 animate-spin text-[#E8A84C]" />
        <p className="text-sm text-muted-foreground text-center">{processingLabel}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold text-foreground">
          Let&apos;s see what your money is really doing
        </h2>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Upload your recent transactions — a CSV export or a screenshot of your bank statement.
        </p>
      </div>

      {/* Upload zones */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* CSV zone */}
        <div
          className={cn(
            'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-colors cursor-pointer',
            csvDragging
              ? 'border-[#E8A84C] bg-[#E8A84C]/5'
              : 'border-border hover:border-[#E8A84C]/50',
          )}
          onDragOver={(e) => { e.preventDefault(); setCsvDragging(true) }}
          onDragLeave={() => setCsvDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setCsvDragging(false)
            const file = e.dataTransfer.files[0]
            if (file) handleCsvFile(file)
          }}
          onClick={() => csvInputRef.current?.click()}
        >
          <Upload className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">CSV or TSV file</p>
            <p className="text-xs text-muted-foreground mt-1">
              Export from your bank app
            </p>
          </div>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,.tsv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleCsvFile(file)
            }}
          />
        </div>

        {/* Screenshot zone */}
        <div
          className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border p-6 text-center transition-colors cursor-pointer hover:border-[#E8A84C]/50"
          onClick={() => imageInputRef.current?.click()}
        >
          <Camera className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">Bank statement screenshot</p>
            <p className="text-xs text-muted-foreground mt-1">
              JPG, PNG, or HEIC
            </p>
          </div>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/heic,image/heif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleImageFile(file)
            }}
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Sample data fallback */}
      <div className="text-center">
        <button
          onClick={handleSampleData}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-[#E8A84C] transition-colors py-2 px-3 min-h-[44px]"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Or try with example data
        </button>
      </div>
    </div>
  )
}
