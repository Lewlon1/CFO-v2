"use client"

import { useState, useMemo } from "react"
import Papa from "papaparse"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { useTrackEvent } from "@/lib/events/use-track-event"
import { CsvDropzone } from "./csv-dropzone"
import { ImageDropzone } from "./image-dropzone"
import { CsvColumnMapper } from "./csv-column-mapper"
import { CsvPreviewTable } from "./csv-preview-table"
import { detectColumnMapping, isMappingHighConfidence } from "@/lib/csv/column-detector"
import { transformRow } from "@/lib/csv/transform"
import { generateExternalId } from "@/lib/csv/hash"
import { categoriseTransaction } from "@/lib/categorisation/categorise-transaction"
import { normaliseMerchant } from "@/lib/categorisation/normalise-merchant"
import { aiCategoriseBatch } from "@/lib/categorisation/ai-categorise"

// Common bank category labels → internal category names
const BANK_CATEGORY_MAP: Record<string, string> = {
  "eating out": "Dining out",
  "food and drink": "Dining out",
  "restaurants": "Dining out",
  "groceries": "Groceries",
  "supermarkets": "Groceries",
  "entertainment": "Entertainment",
  "subscriptions": "Subscriptions",
  "transport": "Transport",
  "travel": "Travel",
  "holidays": "Travel",
  "holiday": "Travel",
  "shopping": "Shopping",
  "bills": "Utilities",
  "utilities": "Utilities",
  "bills and utilities": "Utilities",
  "health": "Healthcare",
  "health and fitness": "Healthcare",
  "medical": "Healthcare",
  "personal care": "Healthcare",
  "education": "Other expense",
  "insurance": "Insurance",
  "housing": "Housing",
  "rent": "Housing",
  "mortgage": "Housing",
  "council tax": "Housing",
  "alquiler": "Housing",
  "hipoteca": "Housing",
  "miete": "Housing",
}

function resolveBankCategory(rawCategory: string, categories: Category[]): Category | null {
  if (!rawCategory) return null
  const lower = rawCategory.toLowerCase().trim()
  // Skip generic labels that don't help
  if (lower === "general" || lower === "finances" || lower === "cash" || lower === "income") return null
  // Synonym map first
  const mapped = BANK_CATEGORY_MAP[lower]
  const targetName = mapped ?? rawCategory
  return categories.find((c) => c.name.toLowerCase() === targetName.toLowerCase()) ?? null
}
import type { MerchantMapping } from "@/lib/categorisation/categorise-transaction"
import type { ColumnMapping, TransformedRow } from "@/lib/csv/transform"
import type { BankAccount, Category, TransactionType } from "@/lib/types/database"
import { CheckCircleIcon, ArrowLeftIcon, PencilIcon } from "lucide-react"

type WizardStep = "drop" | "map" | "preview" | "result"

export type RowStatus = "ready" | "uncategorised" | "duplicate" | "error"

export type PreviewRow = TransformedRow & {
  status: RowStatus
  external_id: string
  normalised_merchant: string
  ai_suggested?: boolean
}

type Props = {
  accounts: BankAccount[]
  categories: Category[]
  defaultCurrency: string
  profileId: string
}

export function CsvUploadWizard({ accounts, categories, defaultCurrency, profileId }: Props) {
  const supabase = createClient()
  const { toast } = useToast()
  const trackEvent = useTrackEvent()

  const [step, setStep] = useState<WizardStep>("drop")
  const [parseResult, setParseResult] = useState<Papa.ParseResult<Record<string, string>> | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [selectedAccountId, setSelectedAccountId] = useState(accounts[0]?.id ?? "")
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([])
  const [merchantMappings, setMerchantMappings] = useState<MerchantMapping[]>([])
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; categorised: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [aiAnalysing, setAiAnalysing] = useState(false)
  const [imageLoading, setImageLoading] = useState(false)
  const [skippedMapping, setSkippedMapping] = useState(false)

  // Merchant counts for bulk tagging indicators
  const merchantCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of previewRows) {
      if (row.status === "duplicate" || row.status === "error") continue
      const key = row.normalised_merchant
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [previewRows])

  /**
   * Resolves the bank account ID to use for import.
   * Auto-creates "Main Account" if user has no accounts.
   */
  async function resolveAccountId(): Promise<string> {
    if (accounts.length === 1) return accounts[0].id
    if (accounts.length >= 2) return "" // needs user selection

    // No accounts — auto-create
    const { data, error: dbError } = await supabase
      .from("bank_accounts")
      .insert({
        profile_id: profileId,
        name: "Main Account",
        account_type: "checking",
        currency: defaultCurrency,
        current_balance: 0,
        is_active: true,
        institution: null,
        iban: null,
        last_synced_at: null,
      })
      .select("id")
      .single()

    if (dbError || !data) throw new Error("Failed to create default account")
    toast("Created 'Main Account' for your imports")
    return data.id
  }

  /**
   * Core preview builder — shared by auto-skip and manual map paths.
   */
  async function buildPreview(
    result: Papa.ParseResult<Record<string, string>>,
    columnMapping: ColumnMapping,
    accountId: string
  ) {
    setLoadingPreview(true)
    setError(null)

    try {
      const rows = result.data.map((row) =>
        transformRow(row, columnMapping, defaultCurrency)
      )

      const rowsWithIds = await Promise.all(
        rows.map(async (row, index) => ({
          ...row,
          external_id: await generateExternalId(
            row.transaction_date,
            String(row.amount),
            row.description ?? "",
            index
          ),
        }))
      )

      // Load merchant mappings
      const { data: mappings } = await supabase
        .from("merchant_category_map")
        .select("merchant_pattern, category_name, source, profile_id")

      const loadedMappings = (mappings ?? []) as MerchantMapping[]
      setMerchantMappings(loadedMappings)

      // Detect duplicates — chunk into batches of 500 for large CSVs
      const externalIds = rowsWithIds.map((r) => r.external_id).filter(Boolean)
      const existingSet = new Set<string>()

      const BATCH_SIZE = 500
      for (let i = 0; i < externalIds.length; i += BATCH_SIZE) {
        const batch = externalIds.slice(i, i + BATCH_SIZE)
        const { data: existing } = await supabase
          .from("transactions")
          .select("external_id")
          .eq("bank_account_id", accountId)
          .in("external_id", batch)

        for (const r of existing ?? []) {
          if (r.external_id) existingSet.add(r.external_id)
        }
      }

      // Auto-categorise with normalised merchants
      const preview: PreviewRow[] = rowsWithIds.map((row) => {
        const merchantText = row.merchant || row.description || ""
        const normalised = normaliseMerchant(merchantText)

        if (row.parseError) {
          return { ...row, status: "error" as const, normalised_merchant: normalised }
        }
        if (existingSet.has(row.external_id)) {
          return { ...row, status: "duplicate" as const, normalised_merchant: normalised }
        }

        const categoryName = categoriseTransaction(normalised, loadedMappings)
        let category = categoryName !== "Uncategorised"
          ? categories.find((c) => c.name === categoryName)
          : null

        // Fall back to the bank's native category label when merchant matching fails
        if (!category && row.raw_category) {
          category = resolveBankCategory(row.raw_category, categories) ?? null
        }

        return {
          ...row,
          category_name: category?.name,
          category_id: category?.id ?? null,
          status: category ? "ready" as const : "uncategorised" as const,
          normalised_merchant: normalised,
        }
      })

      // ── AI categorisation phase ──────────────────────────────────────────
      const uncategorisedRows = preview.filter((r) => r.status === "uncategorised")

      if (uncategorisedRows.length > 0) {
        setAiAnalysing(true)

        const uniqueMerchantMap = new Map<string, { text: string; amount: number; type: string }>()
        for (const row of uncategorisedRows) {
          if (!uniqueMerchantMap.has(row.normalised_merchant)) {
            uniqueMerchantMap.set(row.normalised_merchant, {
              text: row.normalised_merchant,
              amount: Math.abs(row.amount),
              type: row.type ?? "expense",
            })
          }
        }

        const aiResults = await aiCategoriseBatch(
          Array.from(uniqueMerchantMap.values()),
          categories.map((c) => c.name)
        )

        if (aiResults.size > 0) {
          const patched = preview.map((row) => {
            if (row.status !== "uncategorised") return row
            const aiResult = aiResults.get(row.normalised_merchant)
            if (!aiResult) return row
            const category = categories.find((c) => c.name === aiResult.categoryName)
            if (!category) return row
            return {
              ...row,
              category_name: category.name,
              category_id: category.id,
              status: "ready" as const,
              ai_suggested: true,
            }
          })
          setPreviewRows(patched)
          setAiAnalysing(false)
          setStep("preview")
          return
        }

        setAiAnalysing(false)
      }
      // ── End AI phase ─────────────────────────────────────────────────────

      setPreviewRows(preview)
      setStep("preview")
    } catch (e) {
      setError(e instanceof Error ? e.message : "An unexpected error occurred.")
      setAiAnalysing(false)
    } finally {
      setLoadingPreview(false)
    }
  }

  async function handleParsed(result: Papa.ParseResult<Record<string, string>>) {
    setParseResult(result)
    setError(null)

    const headers = result.meta.fields ?? []
    const detectedMapping = detectColumnMapping(headers)
    setMapping(detectedMapping)

    try {
      const accountId = await resolveAccountId()
      setSelectedAccountId(accountId)

      if (isMappingHighConfidence(detectedMapping) && accountId !== "") {
        setSkippedMapping(true)
        toast("Columns auto-detected — review your transactions")
        await buildPreview(result, detectedMapping, accountId)
      } else {
        setSkippedMapping(false)
        setStep("map")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "An unexpected error occurred.")
      setStep("drop")
    }
  }

  async function handleProceedToPreview() {
    if (!selectedAccountId) {
      setError("Please select an account.")
      return
    }
    if (!parseResult) return
    await buildPreview(parseResult, mapping, selectedAccountId)
  }

  async function handleImageFile(file: File) {
    setImageLoading(true)
    setError(null)

    const formData = new FormData()
    formData.append("image", file)
    formData.append("currency", defaultCurrency)

    try {
      const res = await fetch("/api/transactions/extract-image", {
        method: "POST",
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? "Failed to read your bank statement.")
        setImageLoading(false)
        return
      }

      if (data.confidence === "low" || !data.transactions?.length) {
        setError(
          "Couldn't read transactions from that image. Try a clearer screenshot of your bank statement."
        )
        setImageLoading(false)
        return
      }

      const accountId = await resolveAccountId()
      setSelectedAccountId(accountId)
      setSkippedMapping(true)
      await buildPreviewFromOcr(data.transactions, accountId)
    } catch (e) {
      setError(e instanceof Error ? e.message : "An unexpected error occurred.")
      setImageLoading(false)
    }
  }

  async function buildPreviewFromOcr(
    ocrTransactions: Array<{
      merchant: string
      amount: number
      date: string
      description: string | null
      type: "income" | "expense"
    }>,
    accountId: string
  ) {
    setLoadingPreview(true)
    setError(null)

    try {
      const rowsWithIds = await Promise.all(
        ocrTransactions.map(async (t, index) => ({
          transaction_date: t.date,
          amount: t.amount,
          type: t.type as TransactionType,
          currency: defaultCurrency,
          description: t.description,
          merchant: t.merchant,
          raw_category: undefined,
          parseError: undefined,
          external_id: await generateExternalId(t.date, String(t.amount), t.description ?? "", index),
        }))
      )

      const { data: mappings } = await supabase
        .from("merchant_category_map")
        .select("merchant_pattern, category_name, source, profile_id")

      const loadedMappings = (mappings ?? []) as MerchantMapping[]
      setMerchantMappings(loadedMappings)

      const externalIds = rowsWithIds.map((r) => r.external_id).filter(Boolean)
      const existingSet = new Set<string>()

      if (accountId) {
        const BATCH_SIZE = 500
        for (let i = 0; i < externalIds.length; i += BATCH_SIZE) {
          const batch = externalIds.slice(i, i + BATCH_SIZE)
          const { data: existing } = await supabase
            .from("transactions")
            .select("external_id")
            .eq("bank_account_id", accountId)
            .in("external_id", batch)

          for (const r of existing ?? []) {
            if (r.external_id) existingSet.add(r.external_id)
          }
        }
      }

      const preview: PreviewRow[] = rowsWithIds.map((row) => {
        const merchantText = row.merchant || row.description || ""
        const normalised = normaliseMerchant(merchantText)

        if (existingSet.has(row.external_id)) {
          return { ...row, status: "duplicate" as const, normalised_merchant: normalised }
        }

        const categoryName = categoriseTransaction(normalised, loadedMappings)
        const category =
          categoryName !== "Uncategorised"
            ? categories.find((c) => c.name === categoryName)
            : null

        return {
          ...row,
          category_name: category?.name,
          category_id: category?.id ?? null,
          status: category ? ("ready" as const) : ("uncategorised" as const),
          normalised_merchant: normalised,
        }
      })

      const uncategorisedRows = preview.filter((r) => r.status === "uncategorised")

      if (uncategorisedRows.length > 0) {
        setAiAnalysing(true)

        const uniqueMerchantMap = new Map<string, { text: string; amount: number; type: string }>()
        for (const row of uncategorisedRows) {
          if (!uniqueMerchantMap.has(row.normalised_merchant)) {
            uniqueMerchantMap.set(row.normalised_merchant, {
              text: row.normalised_merchant,
              amount: Math.abs(row.amount),
              type: row.type ?? "expense",
            })
          }
        }

        const aiResults = await aiCategoriseBatch(
          Array.from(uniqueMerchantMap.values()),
          categories.map((c) => c.name)
        )

        if (aiResults.size > 0) {
          const patched = preview.map((row) => {
            if (row.status !== "uncategorised") return row
            const aiResult = aiResults.get(row.normalised_merchant)
            if (!aiResult) return row
            const category = categories.find((c) => c.name === aiResult.categoryName)
            if (!category) return row
            return {
              ...row,
              category_name: category.name,
              category_id: category.id,
              status: "ready" as const,
              ai_suggested: true,
            }
          })
          setPreviewRows(patched)
          setAiAnalysing(false)
          setStep("preview")
          return
        }

        setAiAnalysing(false)
      }

      setPreviewRows(preview)
      setStep("preview")
    } catch (e) {
      setError(e instanceof Error ? e.message : "An unexpected error occurred.")
      setAiAnalysing(false)
    } finally {
      setLoadingPreview(false)
      setImageLoading(false)
    }
  }

  function handleMerchantCategoryChange(index: number, categoryId: string, categoryName: string) {
    setPreviewRows((prev) => {
      const targetRow = prev[index]
      const normMerchant = targetRow.normalised_merchant
      const next = [...prev]
      let affectedCount = 0

      for (let i = 0; i < next.length; i++) {
        if (
          next[i].normalised_merchant === normMerchant &&
          next[i].status !== "duplicate" &&
          next[i].status !== "error"
        ) {
          next[i] = {
            ...next[i],
            category_id: categoryId || null,
            category_name: categoryName || undefined,
            status: categoryId ? "ready" : "uncategorised",
            ai_suggested: false,
          }
          affectedCount++
        }
      }

      if (affectedCount > 1) {
        const displayName = targetRow.merchant || targetRow.description || "Unknown"
        toast(`${affectedCount} transactions from ${displayName} → ${categoryName || "Uncategorised"}`)
      }

      return next
    })
  }

  async function handleImport() {
    if (!selectedAccountId) return
    setImporting(true)
    setError(null)

    try {
      const importableRows = previewRows.filter(
        (r) => r.status === "ready" || r.status === "uncategorised"
      )

      if (importableRows.length === 0) {
        setImportResult({ imported: 0, skipped: previewRows.length, categorised: 0 })
        setStep("result")
        setImporting(false)
        return
      }

      const batchId = crypto.randomUUID()

      const dbRows = importableRows.map((row) => ({
        profile_id: profileId,
        bank_account_id: selectedAccountId,
        transaction_date: row.transaction_date,
        amount: row.amount,
        description: row.description,
        merchant: row.merchant,
        type: row.type,
        currency: row.currency || defaultCurrency,
        is_recurring: false,
        frequency: null,
        next_due_date: null,
        recurrence_end: null,
        source: "csv_import",
        external_id: row.external_id,
        import_batch_id: batchId,
        metadata: {},
        category_id: row.category_id ?? null,
      }))

      const { data, error: dbError } = await supabase
        .from("transactions")
        .insert(dbRows)
        .select("id")

      if (dbError) {
        setError(dbError.message)
        setImporting(false)
        return
      }

      // Save user-changed categories using normalised merchant keys
      const userCategorisedRows = importableRows.filter(
        (r) => r.category_name && r.merchant
      )
      const uniqueMerchantCategories = new Map<string, { catName: string; aiSuggested: boolean }>()
      for (const row of userCategorisedRows) {
        const key = normaliseMerchant(row.merchant ?? "")
        if (key && row.category_name) {
          const existing = uniqueMerchantCategories.get(key)
          // User-edited rows (ai_suggested: false) win over unmodified AI suggestions
          if (!existing || (!row.ai_suggested && existing.aiSuggested)) {
            uniqueMerchantCategories.set(key, {
              catName: row.category_name,
              aiSuggested: row.ai_suggested === true,
            })
          }
        }
      }

      for (const [pattern, { catName, aiSuggested }] of uniqueMerchantCategories) {
        const wasAutoMatch = categoriseTransaction(pattern, merchantMappings)
        if (wasAutoMatch === catName) continue

        await supabase
          .from("merchant_category_map")
          .upsert(
            {
              profile_id: profileId,
              merchant_pattern: pattern,
              category_name: catName,
              source: aiSuggested ? "ai" : "user",
            },
            { onConflict: "id" }
          )
      }

      const imported = data?.length ?? 0
      const skipped = previewRows.length - importableRows.length
      const categorised = importableRows.filter((r) => r.category_id).length

      setImportResult({ imported, skipped, categorised })
      setStep("result")
      trackEvent('csv_upload_complete', 'explicit', { transactionCount: imported, skippedCount: skipped })
    } catch (e) {
      setError(e instanceof Error ? e.message : "An unexpected error occurred.")
    }

    setImporting(false)
  }

  function handleReset() {
    setStep("drop")
    setParseResult(null)
    setMapping({})
    setPreviewRows([])
    setMerchantMappings([])
    setImportResult(null)
    setError(null)
    setSkippedMapping(false)
    setImageLoading(false)
  }

  const headers = parseResult?.meta.fields ?? []
  const rawPreviewRows = parseResult?.data.slice(0, 5) ?? []

  const readyCount = previewRows.filter((r) => r.status === "ready").length
  const uncategorisedCount = previewRows.filter((r) => r.status === "uncategorised").length
  const duplicateCount = previewRows.filter((r) => r.status === "duplicate").length
  const errorCount = previewRows.filter((r) => r.status === "error").length
  const importableCount = readyCount + uncategorisedCount

  // Dynamic step list
  const steps: { key: WizardStep; label: string }[] = skippedMapping
    ? [
        { key: "drop", label: "Upload" },
        { key: "preview", label: "Review" },
        { key: "result", label: "Done" },
      ]
    : [
        { key: "drop", label: "Upload" },
        { key: "map", label: "Map columns" },
        { key: "preview", label: "Review" },
        { key: "result", label: "Done" },
      ]

  const currentStepIndex = steps.findIndex((s) => s.key === step)

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <div
              className={
                i === currentStepIndex
                  ? "font-semibold text-foreground"
                  : i < currentStepIndex
                  ? "text-muted-foreground line-through"
                  : "text-muted-foreground"
              }
            >
              {i + 1}. {s.label}
            </div>
            {i < steps.length - 1 && <span className="text-muted-foreground">→</span>}
          </div>
        ))}
      </div>

      {/* Step: Drop */}
      {step === "drop" && (
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Upload CSV
            </p>
            <CsvDropzone onParsed={handleParsed} onError={setError} />
          </div>

          <div className="flex sm:flex-col items-center justify-center gap-2 sm:py-12">
            <div className="h-px w-8 sm:h-8 sm:w-px bg-border" />
            <span className="text-xs text-muted-foreground shrink-0">or</span>
            <div className="h-px w-8 sm:h-8 sm:w-px bg-border" />
          </div>

          <div className="flex-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Upload a screenshot
            </p>
            {imageLoading ? (
              <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-input p-12 text-center gap-3">
                <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                <p className="text-sm text-muted-foreground">Reading your bank statement…</p>
              </div>
            ) : (
              <ImageDropzone onFile={handleImageFile} onError={setError} />
            )}
          </div>
        </div>
      )}

      {/* Step: Map */}
      {step === "map" && (
        <div className="space-y-4">
          <CsvColumnMapper
            headers={headers}
            previewRows={rawPreviewRows}
            mapping={mapping}
            onMappingChange={setMapping}
            accounts={accounts}
            selectedAccountId={selectedAccountId}
            onAccountChange={setSelectedAccountId}
          />
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleReset}>
              <ArrowLeftIcon className="size-4 mr-1" />
              Back
            </Button>
            <Button onClick={handleProceedToPreview} disabled={loadingPreview}>
              {loadingPreview ? "Analysing…" : "Preview transactions"}
            </Button>
          </div>
        </div>
      )}

      {/* Step: Preview / Review */}
      {step === "preview" && (
        <div className="space-y-4">
          {/* All-duplicates early exit */}
          {importableCount === 0 && duplicateCount > 0 ? (
            <div className="flex flex-col items-center py-12 text-center space-y-4">
              <CheckCircleIcon className="size-10 text-muted-foreground" />
              <div>
                <p className="font-medium">
                  All {duplicateCount} transactions already imported
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  This file has been uploaded before. No new transactions to import.
                </p>
              </div>
              <Button variant="outline" onClick={handleReset}>
                Upload a different file
              </Button>
            </div>
          ) : (
            <>
              {/* Summary bar */}
              <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
                <span>
                  <span className="font-medium text-green-600">{importableCount}</span>{" "}
                  <span className="text-muted-foreground">new</span>
                </span>
                {uncategorisedCount > 0 && (
                  <span>
                    <span className="font-medium text-amber-600">{uncategorisedCount}</span>{" "}
                    <span className="text-muted-foreground">need categorisation</span>
                  </span>
                )}
                {duplicateCount > 0 && (
                  <span>
                    <span className="font-medium text-muted-foreground">{duplicateCount}</span>{" "}
                    <span className="text-muted-foreground">already imported (will skip)</span>
                  </span>
                )}
                {errorCount > 0 && (
                  <span>
                    <span className="font-medium text-red-500">{errorCount}</span>{" "}
                    <span className="text-muted-foreground">parse errors</span>
                  </span>
                )}
                {skippedMapping && (
                  <button
                    type="button"
                    className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => {
                      setSkippedMapping(false)
                      setStep("map")
                    }}
                  >
                    <PencilIcon className="size-3" />
                    Edit column mapping
                  </button>
                )}
              </div>

              <CsvPreviewTable
                rows={previewRows}
                currency={defaultCurrency}
                categories={categories}
                onRowCategoryChange={handleMerchantCategoryChange}
                merchantCounts={merchantCounts}
              />

              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => setStep(skippedMapping ? "drop" : "map")}>
                  <ArrowLeftIcon className="size-4 mr-1" />
                  Back
                </Button>
                <Button onClick={handleImport} disabled={importing || importableCount === 0}>
                  {importing
                    ? "Importing…"
                    : `Import ${importableCount} transactions`}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Step: Result */}
      {step === "result" && importResult && (
        <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
          <CheckCircleIcon className="size-12 text-green-500" />
          <div>
            <p className="text-lg font-semibold">Import complete</p>
            <p className="text-sm text-muted-foreground mt-1">
              {importResult.imported} imported
              {importResult.categorised > 0 && `, ${importResult.categorised} auto-categorised`}
              {importResult.skipped > 0 && `, ${importResult.skipped} duplicates skipped`}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleReset}>
              Upload another file
            </Button>
            <a
              href="/settings/transactions"
              className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              View transactions
            </a>
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {loadingPreview && step === "drop" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="size-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            Analysing your file…
          </div>
          {aiAnalysing && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground pl-6">
              <div className="size-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
              AI is analysing uncategorised transactions…
            </div>
          )}
        </div>
      )}

      {!loadingPreview && aiAnalysing && step === "drop" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="size-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          AI is categorising transactions…
        </div>
      )}
    </div>
  )
}
