import { NextRequest, NextResponse } from 'next/server'
// GDPR: This route runs in eu-west-1 (Dublin) via Vercel function region config.
// Any Bedrock calls for categorisation use the EU inference profile.
import { createClient } from '@/lib/supabase/server'
import { detectFormat } from '@/lib/parsers'
import { parseRevolutCSV } from '@/lib/parsers/revolut'
import { parseSantanderXLSX } from '@/lib/parsers/santander'
import { parseMonzoCSV } from '@/lib/parsers/monzo'
import { parseStarlingCSV } from '@/lib/parsers/starling'
import { parseHsbcCSV } from '@/lib/parsers/hsbc'
import { parseBarclaysCSV } from '@/lib/parsers/barclays'
import { parseGenericCSV, applyColumnMapping } from '@/lib/parsers/generic'
import { parseScreenshot } from '@/lib/parsers/screenshot'
import { detectHoldingsMapping } from '@/lib/parsers/holdings-detector'
import { parseHoldingsCSV } from '@/lib/parsers/holdings-csv'
import { parseBalanceSheetScreenshot } from '@/lib/parsers/balance-sheet-screenshot'
import { parseBalanceSheetPDF } from '@/lib/parsers/balance-sheet-pdf'
import { parsePdfTransactions } from '@/lib/parsers/pdf-transactions'
import { runBalanceSheetImport } from '@/lib/upload/balance-sheet-import'
import type { ConfirmedBalanceSheetImport } from '@/lib/upload/balance-sheet-import'
import Papa from 'papaparse'
import { categoriseByRules } from '@/lib/categorisation/rules-engine'
import { assignValueCategory } from '@/lib/categorisation/value-categoriser'
import { extractSignals, type MerchantHistory } from '@/lib/categorisation/context-signals'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import { loadExistingKeys, isDuplicate } from '@/lib/upload/duplicate-detector'
import { runImportPipeline, type ImportableTransaction } from '@/lib/upload/pipeline'
import { refreshMonthlySnapshots, extractAffectedMonths } from '@/lib/analytics/monthly-snapshot'
import { detectAndFlagRecurring } from '@/lib/analytics/recurring-detector'
import { detectAndFlagHolidaySpend } from '@/lib/analytics/holiday-detector'
import { evaluatePaydaySavings } from '@/lib/nudges/evaluators/payday-savings'
import { evaluateValueMapRetake } from '@/lib/nudges/evaluators/value-map-retake'
import type {
  Category,
  ValueCategoryRule,
  UserMerchantRule,
  RecurringMatch,
  PreviewTransaction,
  ParsedTransaction,
  ParseResult,
} from '@/lib/parsers/types'
import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendAlert } from '@/lib/alerts/notify'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const contentType = req.headers.get('content-type') ?? ''

  // ── JSON actions ──────────────────────────────────────────────
  if (contentType.includes('application/json')) {
    const body = await req.json()

    // Confirm import
    if (body.action === 'import') {
      const importBatchId: string = body.importBatchId ?? randomUUID()
      // Map user-reviewed preview data to ImportableTransaction format
      const importTxns: ImportableTransaction[] = (body.transactions as Array<ParsedTransaction & { categoryId?: string | null; valueCategory?: string }>).map((t) => ({
        ...t,
        presetCategoryId: t.categoryId,
        presetValueCategory: t.valueCategory,
      }))
      const stats = await runImportPipeline(importTxns, supabase, {
        userId: user.id,
        importBatchId,
        skipDuplicates: false, // user already reviewed and selected
      })

      // Post-import analytics
      const months = extractAffectedMonths(importTxns.map((t) => t.date))
      await refreshMonthlySnapshots(supabase, user.id, months)
      await detectAndFlagRecurring(supabase, user.id)

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('primary_currency')
        .eq('id', user.id)
        .single()
      const primaryCurrency = profile?.primary_currency ?? 'EUR'
      await detectAndFlagHolidaySpend(supabase, user.id, primaryCurrency, importBatchId)

      // Check for payday (salary deposit) in imported transactions
      evaluatePaydaySavings(supabase, user.id).catch(() => {})

      // Check if CFO should propose a personal Value Map retake (cooldown-gated)
      evaluateValueMapRetake(supabase, user.id).catch(() => {})

      // Check if monthly review is available (2+ months of snapshots, latest unreviewed)
      const [{ count: snapshotCount }, { data: unreviewedSnap }] = await Promise.all([
        supabase
          .from('monthly_snapshots')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id),
        supabase
          .from('monthly_snapshots')
          .select('month')
          .eq('user_id', user.id)
          .is('reviewed_at', null)
          .order('month', { ascending: false })
          .limit(1)
          .single(),
      ])

      return NextResponse.json({
        ...stats,
        review_available: (snapshotCount ?? 0) >= 2 && unreviewedSnap !== null,
        review_month: unreviewedSnap?.month?.slice(0, 7) ?? null,
      })
    }

    // Confirm a balance sheet import (holdings / single asset / liability)
    if (body.action === 'import-balance-sheet') {
      const payload = body.data as ConfirmedBalanceSheetImport | undefined
      if (!payload) {
        return NextResponse.json({ error: 'Missing import payload.' }, { status: 400 })
      }
      const result = await runBalanceSheetImport(supabase, user.id, payload)
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 })
      }
      return NextResponse.json({ ok: true, ...result.summary })
    }

    // Apply column mapping → return preview
    if (body.action === 'apply-mapping') {
      const result = applyColumnMapping(
        body.rawRows as Record<string, string>[],
        body.mapping as Record<string, string>,
        body.currency ?? 'EUR'
      )
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
      const preview = await buildPreview(result.transactions, user.id, supabase)
      return NextResponse.json({ preview, importBatchId: randomUUID() })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  // ── File upload → parse → preview ─────────────────────────────
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  // File size limit: 10MB
  const MAX_FILE_SIZE = 10 * 1024 * 1024
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: 'File too large. Maximum size is 10MB.' },
      { status: 413 }
    )
  }

  // File type validation
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
    return NextResponse.json(
      { error: 'Unsupported file type. We accept CSV, Excel, PDF, and screenshot images.' },
      { status: 415 }
    )
  }

  const filename = file.name

  // Upload context: 'transactions' (default, existing behaviour) or
  // 'balance_sheet' (holdings / debts / portfolio screenshots).
  const uploadContext = (formData.get('upload_context') as string | null) ?? 'transactions'
  const isBalanceSheetContext = uploadContext === 'balance_sheet'

  // Quick format sniff without reading full text first
  const lowerName = filename.toLowerCase()
  const isImage = /\.(png|jpg|jpeg|heic|webp)$/.test(lowerName)
  const isXlsx = /\.(xlsx|xls)$/.test(lowerName)
  const isPdf = /\.pdf$/.test(lowerName)

  // ── PDF branch — balance sheet or transaction extraction ──
  if (isPdf && isBalanceSheetContext) {
    const buffer = await file.arrayBuffer()
    const result = await parseBalanceSheetPDF(buffer, user.id)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 422 })
    }
    return NextResponse.json({
      type: 'balance_sheet_pdf',
      data: result.data,
      suggestedAssetName: result.data.account_name ?? null,
      suggestedProvider: result.data.provider ?? null,
    })
  }

  if (isPdf) {
    const buffer = await file.arrayBuffer()
    const result = await parsePdfTransactions(buffer, user.id)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 422 })
    }
    const clientBatchId = formData.get('batchId') as string | null
    const preview = await buildPreview(result.transactions, user.id, supabase)
    return NextResponse.json({ preview, importBatchId: clientBatchId ?? randomUUID() })
  }

  // ── Balance sheet screenshot branch ──
  if (isImage && isBalanceSheetContext) {
    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const mimeType = file.type || 'image/jpeg'
    const dataUrl = `data:${mimeType};base64,${base64}`
    const result = await parseBalanceSheetScreenshot(dataUrl, user.id)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 422 })
    }
    return NextResponse.json({
      type: 'balance_sheet_screenshot',
      data: result.data,
      suggestedAssetName: result.data.account_name ?? null,
      suggestedProvider: result.data.provider ?? null,
    })
  }

  let parseResult: Awaited<ReturnType<typeof parseRevolutCSV>> | null = null
  let needsColumnMapping = false
  let columnMappingData: {
    headers: string[]
    autoMapping: Record<string, string>
    rawRows: Record<string, string>[]
  } | null = null

  if (isImage) {
    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const mimeType = file.type || 'image/jpeg'
    const dataUrl = `data:${mimeType};base64,${base64}`
    parseResult = await parseScreenshot(dataUrl, user.id)
  } else if (isXlsx) {
    const buffer = await file.arrayBuffer()
    parseResult = parseSantanderXLSX(buffer)
  } else {
    const text = await file.text()

    // Try holdings detection BEFORE transaction detection so a Vanguard
    // export doesn't get mis-routed into the generic transaction parser.
    const headerSniff = Papa.parse<Record<string, string>>(text, {
      header: true,
      preview: 1,
    })
    const headers = headerSniff.meta.fields ?? []
    const holdingsMapping = detectHoldingsMapping(headers)

    if (holdingsMapping) {
      const holdingsResult = parseHoldingsCSV(text, holdingsMapping, filename)
      if (holdingsResult.ok) {
        return NextResponse.json({
          type: 'holdings',
          holdings: holdingsResult.holdings,
          suggestedAssetName: holdingsResult.suggestedAssetName,
          suggestedProvider: holdingsResult.suggestedProvider,
        })
      }
      // If holdings detection matched but parsing failed, fall back to an
      // error rather than silently trying to parse as transactions — the
      // column shape told us it wasn't a transaction file.
      return NextResponse.json({ error: holdingsResult.error }, { status: 422 })
    }

    const format = detectFormat(filename, text)
    if (format === 'revolut') {
      parseResult = parseRevolutCSV(text)
    } else if (format === 'monzo') {
      parseResult = parseMonzoCSV(text)
    } else if (format === 'starling') {
      parseResult = parseStarlingCSV(text)
    } else if (format === 'hsbc') {
      parseResult = parseHsbcCSV(text)
    } else if (format === 'barclays') {
      parseResult = parseBarclaysCSV(text)
    } else {
      const genericResult = parseGenericCSV(text)
      if ('needsMapping' in genericResult && genericResult.needsMapping) {
        needsColumnMapping = true
        columnMappingData = {
          headers: genericResult.headers,
          autoMapping: genericResult.autoMapping,
          rawRows: genericResult.rawRows,
        }
      } else {
        parseResult = genericResult as ParseResult
      }
    }
  }

  if (needsColumnMapping && columnMappingData) {
    return NextResponse.json({
      needsColumnMapping: true,
      ...columnMappingData,
    })
  }

  if (!parseResult) {
    sendAlert({
      severity: 'critical',
      event: 'csv_parse_failed',
      user_id: user.id,
      details: `No parser matched for file "${filename}" (${file.size} bytes).`,
      metadata: { filename, fileSize: file.size },
    }).catch(() => {})
    return NextResponse.json({ error: 'Could not parse file.' }, { status: 422 })
  }

  if (!parseResult.ok) {
    sendAlert({
      severity: 'critical',
      event: 'csv_parse_failed',
      user_id: user.id,
      details: `Parser returned error for "${filename}": ${parseResult.error}`,
      metadata: { filename, fileSize: file.size, error: parseResult.error },
    }).catch(() => {})
    return NextResponse.json({ error: parseResult.error }, { status: 422 })
  }

  const clientBatchId = (formData.get('batchId') as string | null)
  const preview = await buildPreview(parseResult.transactions, user.id, supabase)
  return NextResponse.json({ preview, importBatchId: clientBatchId ?? randomUUID() })
}

async function buildPreview(
  transactions: ParsedTransaction[],
  userId: string,
  supabase: SupabaseClient
): Promise<PreviewTransaction[]> {
  if (transactions.length === 0) return []

  const [
    { data: catData },
    { data: rulesData },
    { data: merchantRulesData },
    { data: recurringData },
    { data: historyData },
  ] = await Promise.all([
    supabase
      .from('categories')
      .select('id, name, tier, icon, color, examples, default_value_category')
      .eq('is_active', true),
    supabase
      .from('value_category_rules')
      .select('id, match_type, match_value, value_category, confidence, total_signals, agreement_ratio, avg_amount_low, avg_amount_high, time_context, source, last_signal_at')
      .eq('user_id', userId),
    supabase
      .from('user_merchant_rules')
      .select('normalised_merchant, category_id, confidence')
      .eq('user_id', userId),
    supabase
      .from('recurring_expenses')
      .select('name, category_id')
      .eq('user_id', userId),
    supabase.rpc('merchant_history', { p_user_id: userId }).then(
      (res) => res,
      () => ({ data: null, error: null })
    ),
  ])

  const categories: Category[] = catData ?? []
  const userRules: ValueCategoryRule[] = rulesData ?? []
  const userMerchantRules: UserMerchantRule[] = merchantRulesData ?? []
  const recurringExpenses: RecurringMatch[] = recurringData ?? []

  const merchantHistory = new Map<string, MerchantHistory>()
  if (historyData && Array.isArray(historyData)) {
    for (const row of historyData) {
      merchantHistory.set(row.merchant, {
        count: Number(row.count),
        median_amount: Number(row.median_amount),
      })
    }
  }

  const batchSummaries = transactions.map((t) => ({
    date: t.date,
    description: t.description,
  }))

  const dates = transactions.map((t) => t.date).sort()
  const existingKeys = await loadExistingKeys(
    supabase,
    userId,
    dates[0],
    dates[dates.length - 1]
  )

  return transactions.map((txn, i) => {
    const catResult = categoriseByRules(txn.description, {
      categories,
      amount: txn.amount,
      userMerchantRules,
      recurringExpenses,
    })
    const isRecurring = recurringExpenses.some(
      (r) => normaliseMerchant(txn.description) === normaliseMerchant(r.name)
    )
    const signals = extractSignals(
      { date: txn.date, description: txn.description, amount: txn.amount, is_recurring: isRecurring },
      merchantHistory,
      batchSummaries
    )
    const valResult = assignValueCategory(
      txn.description,
      catResult.categoryId,
      userRules,
      categories,
      signals,
      txn.amount
    )
    return {
      ...txn,
      suggestedCategoryId: catResult.categoryId,
      suggestedValueCategory: valResult.valueCategory,
      suggestedValueConfidence: valResult.confidence,
      isDuplicate: isDuplicate(txn, existingKeys),
      rowIndex: i,
    }
  })
}
