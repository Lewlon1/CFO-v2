// /api/extract-pdf-transactions
//
// Vision-based PDF extraction — the single PDF path after the Strategy
// A (text-layer + column alignment) removal. Callers render statement
// pages to PNG in-browser and POST them here; we run Haiku vision via
// the EU Bedrock inference profile and return
//
//   { transactions, metadata?, warnings? }
//
// `transactions` are ParsedTransaction[] with the signed-amount
// invariant (debits negative, credits positive).
// `metadata` carries account-level facts (opening/closing balance,
// statement period, account currency) when Haiku is confident.
// `warnings` includes 'balance_mismatch' when the extracted txn sum
// can't be reconciled against opening→closing balances.
//
// Privacy: page images DO leave the browser. Every invocation is
// logged via trackLLMUsage so usage is visible in llm_usage_log.

import { NextRequest, NextResponse } from 'next/server'
import { generateText } from 'ai'
import { z } from 'zod'
import { utilityModel, utilityModelId } from '@/lib/ai/provider'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { trackLLMUsage } from '@/lib/analytics/track-llm-usage'
import { checkLlmAllowed, LLM_LIMIT_MESSAGE } from '@/lib/ai/llm-guard'
import type { ParsedTransaction } from '@/lib/parsers/types'

export const runtime = 'nodejs'
// Raised from 90 → 300 (Vercel ceiling) as a safety net: the per-page vision
// loop below is now parallelised with bounded concurrency, but a large
// statement under Bedrock back-pressure can still run long. 300s prevents a
// silent platform-level timeout from killing an in-flight extraction.
export const maxDuration = 300

// Bounded concurrency for the per-page vision calls. ~4-5 keeps us under
// Bedrock per-account rate limits while collapsing a 5-10 page statement from
// 30-80s sequential to roughly ceil(pages/PAGE_CONCURRENCY) × per-page latency.
const PAGE_CONCURRENCY = 5

const RequestSchema = z.object({
  // Each image is a data URL — "data:image/png;base64,..."
  images: z.array(z.string().min(32)).min(1).max(20),
  currencyDefault: z.string().min(3).max(3).optional(),
})

// Per-page model response. Haiku returns only what it sees on THIS
// page, so metadata may be null on every page except the cover/last.
const PageSchema = z.object({
  transactions: z.array(
    z.object({
      date: z.string(),
      description: z.string(),
      amount: z.number(),
      balance: z.number().nullable().optional(),
    }),
  ),
  openingBalance: z.number().nullable().optional(),
  closingBalance: z.number().nullable().optional(),
  statementPeriodStart: z.string().nullable().optional(),
  statementPeriodEnd: z.string().nullable().optional(),
  accountCurrency: z.string().nullable().optional(),
})

const EXTRACTION_PROMPT = `You are extracting transactions from ONE page of a bank statement.

Return ONLY a JSON object — no markdown fences, no prose.

{
  "transactions": [
    { "date": "YYYY-MM-DD", "description": "merchant / narrative", "amount": -42.50, "balance": 1250.00 }
  ],
  "openingBalance": 1250.00,
  "closingBalance": 999.00,
  "statementPeriodStart": "YYYY-MM-DD",
  "statementPeriodEnd": "YYYY-MM-DD",
  "accountCurrency": "EUR"
}

Transaction rules:
- Debits (money OUT of the account) MUST be negative.
- Credits (money IN) MUST be positive.
- Dates MUST be ISO 8601 (YYYY-MM-DD).
- If the page uses DD/MM/YYYY, convert it.
- Multi-line descriptions: join lines with a single space into one description.
- If a transaction has no numeric amount on this page (e.g. pending holds, footnotes), skip it.

Rows to SKIP (do not include in transactions):
- Opening balance / closing balance / "Balance brought forward" / "Balance carried forward"
- Running subtotals, section totals, page totals, "Total debits", "Total credits"
- Column headers ("Date", "Description", "Amount", "Balance", etc.)
- Promotional text, disclaimers, footers, page numbers

Metadata rules:
- openingBalance / closingBalance: the account-level opening and closing balance on the statement (usually on the cover page or last page). NOT a running balance row. Null on pages where it isn't shown.
- statementPeriodStart / statementPeriodEnd: the declared statement period (e.g. "1 March 2026 to 31 March 2026"). Null if absent.
- accountCurrency: the PRIMARY account currency from the header / IBAN / account details. For a Revolut multi-currency wallet, this is the base account currency, NOT the currency of any transient sub-wallet shown in a transaction list.
- If a field is genuinely not present on THIS page, return null for it.

If the page has no transactions AND no metadata, return:
{ "transactions": [], "openingBalance": null, "closingBalance": null, "statementPeriodStart": null, "statementPeriodEnd": null, "accountCurrency": null }`

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // LLM cost guard — each request can fan out to 20 Haiku-vision calls, so
  // this route gets its own (tight) burst + daily caps.
  const guardVerdict = await checkLlmAllowed({ userId: user.id, surface: 'pdf_vision', supabase })
  if (!guardVerdict.allowed) {
    console.warn(`[extract-pdf] llm-guard blocked user ${user.id}: ${guardVerdict.reason}`)
    return NextResponse.json({ error: 'limit', message: LLM_LIMIT_MESSAGE }, { status: 429 })
  }

  let body: z.infer<typeof RequestSchema>
  try {
    body = RequestSchema.parse(await req.json())
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request'
    return NextResponse.json({ error: 'bad_request', detail: message }, { status: 400 })
  }

  const fallbackCurrency = (body.currencyDefault ?? 'GBP').toUpperCase()
  const transactionsByKey = new Map<string, ParsedTransaction>()
  const pageCount = body.images.length

  // Account-level metadata, reduced across pages. First non-null wins
  // for each field — cover page populates period + opening; last page
  // populates closing. Currency resolves from any page that has it.
  let openingBalance: number | null = null
  let closingBalance: number | null = null
  let statementPeriodStart: string | null = null
  let statementPeriodEnd: string | null = null
  let accountCurrency: string | null = null

  // The per-page vision loop is now PARALLEL with bounded concurrency
  // (PAGE_CONCURRENCY). Pages have no inter-dependency for extraction, so they
  // run concurrently — but the metadata reduction below depends on PAGE ORDER.
  // `runPage` returns a per-page result (parsed payload, or null on failure);
  // `runWithConcurrency` preserves index order in its returned array, so we
  // reduce metadata over pages in order: `openingBalance`/`statementPeriodStart`
  // take the FIRST non-null, `closingBalance`/`statementPeriodEnd` take the
  // LAST non-null, `accountCurrency` is FIRST non-null. Transaction
  // concatenation also walks pages in order.
  const pageResults = await runWithConcurrency(
    body.images.map((dataUrl, i) => () => runPage(dataUrl, i, pageCount, user.id)),
    PAGE_CONCURRENCY,
  )

  // Pages that threw or failed schema parse. Surfaced in the response so the
  // caller can distinguish a partial extraction from a clean one.
  const failedPages: number[] = []

  // Reduce in page order (pageResults is index-aligned with body.images).
  for (let i = 0; i < pageResults.length; i++) {
    const parsed = pageResults[i]
    if (parsed === null) {
      failedPages.push(i)
      continue
    }

    if (openingBalance === null && typeof parsed.openingBalance === 'number') {
      openingBalance = parsed.openingBalance
    }
    if (typeof parsed.closingBalance === 'number') {
      closingBalance = parsed.closingBalance
    }
    if (statementPeriodStart === null && parsed.statementPeriodStart) {
      statementPeriodStart = parsed.statementPeriodStart
    }
    if (parsed.statementPeriodEnd) {
      statementPeriodEnd = parsed.statementPeriodEnd
    }
    if (accountCurrency === null && parsed.accountCurrency) {
      accountCurrency = parsed.accountCurrency.toUpperCase()
    }

    for (const item of parsed.transactions) {
      const date = item.date.slice(0, 10)
      const description = item.description.trim()
      const amount = item.amount
      if (!date || !description || !Number.isFinite(amount) || amount === 0) continue

      // Dedup across pages: same date + amount + normalised description.
      const key = `${date}|${amount}|${description.toLowerCase()}`
      if (transactionsByKey.has(key)) continue

      const balance =
        typeof item.balance === 'number' && Number.isFinite(item.balance) ? item.balance : null

      transactionsByKey.set(key, {
        date: `${date}T00:00:00Z`,
        description,
        amount,
        currency: accountCurrency ?? fallbackCurrency,
        source: 'pdf_vision',
        raw_description: description,
        balance,
      })
    }
  }

  // Retroactively upgrade the currency on transactions extracted before
  // we saw `accountCurrency` on a later page.
  if (accountCurrency) {
    for (const tx of transactionsByKey.values()) {
      if (tx.currency !== accountCurrency) tx.currency = accountCurrency
    }
  }

  const transactions = Array.from(transactionsByKey.values())

  const warnings: string[] = []
  if (openingBalance !== null && closingBalance !== null) {
    const sum = transactions.reduce((acc, t) => acc + t.amount, 0)
    const expected = closingBalance - openingBalance
    if (Math.abs(sum - expected) >= 0.01) {
      warnings.push('balance_mismatch')
    }
  }

  // Overall extraction status:
  //   'failed'  — every page failed (no usable extraction at all)
  //   'partial' — some pages succeeded, some failed
  //   'ok'      — every page parsed
  const pagesSucceeded = pageCount - failedPages.length
  const status: 'ok' | 'partial' | 'failed' =
    pagesSucceeded === 0 ? 'failed' : failedPages.length > 0 ? 'partial' : 'ok'

  // Lightweight import-attempts log. Non-fatal: a logging failure must never
  // block an upload, so the whole insert is wrapped and swallowed.
  try {
    const svc = createServiceClient()
    // TODO: typed once migration applied to staging. The generated Supabase
    // types don't yet include `import_attempts` (regenerated from staging by
    // the lead separately), so the table access is cast to avoid a hard TS
    // failure on an as-yet-unknown table name.
    await (svc.from('import_attempts') as any).insert({
      user_id: user.id,
      source: 'pdf_vision',
      page_count: pageCount,
      pages_succeeded: pagesSucceeded,
      pages_failed: failedPages,
      status,
      error: failedPages.length > 0 ? `${failedPages.length} of ${pageCount} pages failed` : null,
    })
  } catch (err) {
    console.error('[extract-pdf-transactions] import_attempts log failed (non-fatal):', err)
  }

  return NextResponse.json({
    transactions,
    metadata: {
      openingBalance,
      closingBalance,
      statementPeriodStart,
      statementPeriodEnd,
      accountCurrency,
    },
    warnings,
    failedPages,
    status,
  })
}

// Run one page through Haiku vision. Returns the parsed page payload, or null
// if the call threw or the response failed schema validation. Always emits the
// per-page trackLLMUsage record (in `finally`), exactly as the sequential loop
// did. Kept pure of shared state so it is safe to run concurrently.
async function runPage(
  dataUrl: string,
  pageIndex: number,
  pageCount: number,
  userId: string,
): Promise<z.infer<typeof PageSchema> | null> {
  const base64 = extractBase64(dataUrl)
  if (!base64) return null

  const started = Date.now()
  let inputTokens: number | undefined
  let outputTokens: number | undefined
  let text: string
  try {
    const result = await generateText({
      model: utilityModel,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', image: base64, mediaType: 'image/png' },
            { type: 'text', text: EXTRACTION_PROMPT },
          ],
        },
      ],
      maxOutputTokens: 4000,
      // A hung vision call must die here rather than eat the whole route's
      // maxDuration while sibling pages queue behind it in the pool.
      abortSignal: AbortSignal.timeout(25_000),
    })
    text = result.text
    inputTokens = result.usage?.inputTokens
    outputTokens = result.usage?.outputTokens
  } catch (err) {
    console.error('[extract-pdf-transactions] Haiku vision failed:', err)
    return null
  } finally {
    void trackLLMUsage({
      userId,
      callType: 'pdf_vision_extraction',
      model: utilityModelId,
      inputTokens,
      outputTokens,
      durationMs: Date.now() - started,
      metadata: { pageIndex, pageCount },
    })
  }

  const cleaned = text
    .trim()
    .replace(/^```json\n?/i, '')
    .replace(/^```\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim()

  try {
    return PageSchema.parse(JSON.parse(cleaned))
  } catch {
    return null
  }
}

// Bounded-concurrency pool. Runs at most `limit` tasks at once and returns
// results in the SAME ORDER as the input tasks (index-aligned) — the metadata
// reduction depends on this. No new dependency (p-limit is not installed); this
// is a small inline pool of `limit` workers pulling from a shared cursor.
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results = new Array<T>(tasks.length)
  let next = 0
  const worker = async () => {
    while (true) {
      const i = next++
      if (i >= tasks.length) return
      results[i] = await tasks[i]()
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker())
  await Promise.all(workers)
  return results
}

function extractBase64(dataUrl: string): string | null {
  const m = dataUrl.match(/^data:image\/[a-zA-Z+]+;base64,(.*)$/)
  if (m) return m[1]
  if (/^[A-Za-z0-9+/=]+$/.test(dataUrl)) return dataUrl
  return null
}
