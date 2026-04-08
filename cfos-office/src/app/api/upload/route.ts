import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { detectFormat } from '@/lib/parsers'
import { parseRevolutCSV } from '@/lib/parsers/revolut'
import { parseSantanderXLSX } from '@/lib/parsers/santander'
import { parseGenericCSV, applyColumnMapping } from '@/lib/parsers/generic'
import { parseScreenshot } from '@/lib/parsers/screenshot'
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
  const ALLOWED_EXTS = new Set(['csv', 'xlsx', 'xls', 'png', 'jpg', 'jpeg', 'heic', 'webp'])
  if (!ext || !ALLOWED_EXTS.has(ext)) {
    return NextResponse.json(
      { error: 'Unsupported file type. We accept CSV, Excel, and screenshot images.' },
      { status: 415 }
    )
  }

  const filename = file.name

  // Quick format sniff without reading full text first
  const lowerName = filename.toLowerCase()
  const isImage = /\.(png|jpg|jpeg|heic|webp)$/.test(lowerName)
  const isXlsx = /\.(xlsx|xls)$/.test(lowerName)

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
    const format = detectFormat(filename, text)
    if (format === 'revolut') {
      parseResult = parseRevolutCSV(text)
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
    return NextResponse.json({ error: 'Could not parse file.' }, { status: 422 })
  }

  if (!parseResult.ok) {
    return NextResponse.json({ error: parseResult.error }, { status: 422 })
  }

  const preview = await buildPreview(parseResult.transactions, user.id, supabase)
  return NextResponse.json({ preview, importBatchId: randomUUID() })
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
      .select('match_type, match_value, value_category, confidence, source, context_conditions')
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
