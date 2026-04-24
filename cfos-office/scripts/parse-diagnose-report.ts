// Output formatter for scripts/parse-diagnose.ts. Kept separate so the
// CLI orchestration file stays small.

import type { ParsedTransaction } from '../src/lib/parsers/types'

export type Diagnosis = {
  filename: string
  sizeBytes: number
  extension: string
  format: string              // detected format label (e.g. 'csv_universal', 'pdf', 'xlsx_out_of_scope')
  fallbackPath: boolean       // true when the universal parser deferred to a server/other path
  parseMs: number
  ok: boolean
  error?: string
  warnings: string[]
  transactions: ParsedTransaction[]
  skippedRows: number
  openingBalance?: number | null
  closingBalance?: number | null
  periodStart?: string | null
  periodEnd?: string | null
  template?: {
    bankName: string | null
    signConvention: string
    dateFormat: string
    decimalFormat: string
    currencyDefault: string
  }
}

function formatAmount(n: number): string {
  const abs = Math.abs(n)
  return `${n < 0 ? '-' : ''}${abs.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function truncateDesc(s: string, max = 40): string {
  if (s.length <= max) return s
  return s.slice(0, max - 3) + '...'
}

function check(status: 'ok' | 'fail' | 'warn' | 'skip', label: string, detail?: string): string {
  const mark = status === 'ok' ? '✓' : status === 'fail' ? '✗' : status === 'warn' ? '⚠' : '–'
  return `  ${mark} ${label}${detail ? ` ${detail}` : ''}`
}

type InvariantResult = {
  lines: string[]
  allPassed: boolean
  warnCount: number
}

function runInvariants(d: Diagnosis): InvariantResult {
  const lines: string[] = []
  let allPassed = true
  let warnCount = 0

  // 1. non-null dates
  const badDates = d.transactions.filter((t) => !t.date)
  if (badDates.length === 0) lines.push(check('ok', 'All transactions have non-null date'))
  else { allPassed = false; lines.push(check('fail', 'All transactions have non-null date', `(${badDates.length} missing)`)) }

  // 2. non-null finite amounts
  const badAmts = d.transactions.filter((t) => t.amount === null || !Number.isFinite(t.amount))
  if (badAmts.length === 0) lines.push(check('ok', 'All transactions have finite numeric amount'))
  else { allPassed = false; lines.push(check('fail', 'All transactions have finite numeric amount', `(${badAmts.length} invalid)`)) }

  // 3. non-empty description
  const emptyDescs = d.transactions.filter((t) => !t.description || t.description.trim() === '' || t.description.trim() === '(no description)')
  if (emptyDescs.length === 0) lines.push(check('ok', 'All transactions have non-empty description'))
  else { warnCount++; lines.push(check('warn', 'All transactions have non-empty description', `(${emptyDescs.length} blank / "(no description)")`)) }

  // 4. dates within declared period
  if (d.periodStart && d.periodEnd) {
    const outOfRange = d.transactions.filter((t) => t.date < d.periodStart! || t.date > d.periodEnd!)
    if (outOfRange.length === 0) lines.push(check('ok', 'All dates within declared statement period'))
    else { allPassed = false; lines.push(check('fail', 'All dates within declared statement period', `(${outOfRange.length} outside)`)) }
  } else {
    lines.push(check('skip', 'All dates within declared statement period', '(no period metadata)'))
  }

  // 5. duplicates
  const seen = new Map<string, number>()
  for (const t of d.transactions) {
    const key = `${t.date}|${t.amount.toFixed(2)}|${t.description}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  const duplicates = [...seen.values()].filter((v) => v > 1).length
  if (duplicates === 0) lines.push(check('ok', 'No exact duplicates (same date + amount + description)'))
  else { warnCount++; lines.push(check('warn', 'No exact duplicates (same date + amount + description)', `(${duplicates} duplicate groups)`)) }

  // 6. no zero amounts
  const zeros = d.transactions.filter((t) => t.amount === 0)
  if (zeros.length === 0) lines.push(check('ok', 'No zero-amount transactions'))
  else { warnCount++; lines.push(check('warn', 'No zero-amount transactions', `(${zeros.length} zeros)`)) }

  // 7. currency populated
  const noCurrency = d.transactions.filter((t) => !t.currency || t.currency.trim().length === 0)
  if (noCurrency.length === 0) lines.push(check('ok', 'Currency populated on every transaction'))
  else { allPassed = false; lines.push(check('fail', 'Currency populated on every transaction', `(${noCurrency.length} missing)`)) }

  // 8. balance reconciliation
  if (d.openingBalance != null && d.closingBalance != null) {
    const sum = d.transactions.reduce((acc, t) => acc + t.amount, 0)
    const expected = d.closingBalance - d.openingBalance
    const delta = sum - expected
    if (Math.abs(delta) < 0.01) lines.push(check('ok', 'Balance reconciliation', `(open ${formatAmount(d.openingBalance)} → close ${formatAmount(d.closingBalance)})`))
    else { warnCount++; lines.push(check('warn', 'Balance reconciliation', `(Δ ${formatAmount(delta)}; expected Σ=${formatAmount(expected)}, got ${formatAmount(sum)})`)) }
  } else {
    lines.push(check('skip', 'Balance reconciliation', '(opening/closing balance not surfaced)'))
  }

  return { lines, allPassed, warnCount }
}

export function formatDiagnosis(d: Diagnosis): string {
  const out: string[] = []
  out.push(`=== DIAGNOSTIC: ${d.filename} ===`)
  out.push(`File size: ${(d.sizeBytes / 1024).toFixed(1)} KB`)
  out.push(`Extension: ${d.extension}`)
  out.push(`Format detection: ${d.format}`)
  out.push(`Fallback path taken: ${d.fallbackPath ? 'true' : 'false'}`)
  out.push(`Parse duration: ${d.parseMs.toFixed(0)}ms`)

  if (!d.ok) {
    out.push(`✗ PARSE FAILED: ${d.error ?? 'unknown error'}`)
    if (d.warnings.length > 0) {
      out.push('Warnings:')
      for (const w of d.warnings) out.push(`  - ${w}`)
    }
    out.push('')
    return out.join('\n')
  }

  out.push(`Transactions parsed: ${d.transactions.length}${d.skippedRows > 0 ? ` (${d.skippedRows} rows skipped)` : ''}`)

  if (d.template) {
    out.push(`Template:`)
    out.push(`  bank:          ${d.template.bankName ?? '(null)'}`)
    out.push(`  signConvention: ${d.template.signConvention}`)
    out.push(`  dateFormat:    ${d.template.dateFormat}`)
    out.push(`  decimalFormat: ${d.template.decimalFormat}`)
    out.push(`  currencyDefault: ${d.template.currencyDefault}`)
  }

  if (d.transactions.length === 0) {
    out.push('(no transactions to analyse)')
    out.push('')
    return out.join('\n')
  }

  const dates = d.transactions.map((t) => t.date).sort()
  out.push(`Date range: ${dates[0]} → ${dates[dates.length - 1]}`)

  const currencyDist: Record<string, number> = {}
  for (const t of d.transactions) currencyDist[t.currency] = (currencyDist[t.currency] ?? 0) + 1
  const currencyStr = '{ ' + Object.entries(currencyDist).map(([k, v]) => `${k}: ${v}`).join(', ') + ' }'
  out.push(`Currency distribution: ${currencyStr}`)

  const debits = d.transactions.filter((t) => t.amount < 0)
  const credits = d.transactions.filter((t) => t.amount > 0)
  const debitSum = debits.reduce((s, t) => s + t.amount, 0)
  const creditSum = credits.reduce((s, t) => s + t.amount, 0)
  const net = debitSum + creditSum
  const primaryCur = Object.entries(currencyDist).sort(([, a], [, b]) => b - a)[0]?.[0] ?? ''
  out.push(`Amount totals:`)
  out.push(`  Debits:  ${formatAmount(debitSum)} ${primaryCur} (${debits.length} txns)`)
  out.push(`  Credits: ${formatAmount(creditSum)} ${primaryCur} (${credits.length} txns)`)
  out.push(`  Net:     ${formatAmount(net)} ${primaryCur}`)

  const inv = runInvariants(d)
  out.push(`Invariant checks:`)
  for (const l of inv.lines) out.push(l)

  const first3 = d.transactions.slice(0, 3)
  const last3 = d.transactions.slice(-3)
  out.push(`First ${first3.length} transactions:`)
  for (const t of first3) {
    out.push(`  ${t.date.slice(0, 10)} | ${truncateDesc(t.description).padEnd(40)} | ${formatAmount(t.amount).padStart(12)} ${t.currency}`)
  }
  if (d.transactions.length > 3) {
    out.push(`Last ${last3.length} transactions:`)
    for (const t of last3) {
      out.push(`  ${t.date.slice(0, 10)} | ${truncateDesc(t.description).padEnd(40)} | ${formatAmount(t.amount).padStart(12)} ${t.currency}`)
    }
  }

  if (d.warnings.length > 0) {
    out.push(`Anomalies (${d.warnings.length}):`)
    for (const w of d.warnings.slice(0, 15)) out.push(`  - ${w}`)
    if (d.warnings.length > 15) out.push(`  - … and ${d.warnings.length - 15} more`)
  }

  out.push('')
  return out.join('\n')
}

export function formatSummaryTable(results: Diagnosis[]): string {
  const colFixture = 'FIXTURE'
  const colFormat = 'FORMAT'
  const colTxns = 'TXNS'
  const colInv = 'INVARIANTS'
  const colRec = 'RECONCILES'

  const rows = results.map((d) => {
    const inv = d.ok ? runInvariants(d) : { allPassed: false, warnCount: 0, lines: [] }
    const invCol = !d.ok ? '✗ FAIL'
      : inv.allPassed && inv.warnCount === 0 ? '✓'
      : inv.allPassed ? `⚠ ${inv.warnCount} warn`
      : `✗ fail`

    let recCol: string
    if (!d.ok) recCol = '—'
    else if (d.openingBalance != null && d.closingBalance != null) {
      const sum = d.transactions.reduce((acc, t) => acc + t.amount, 0)
      const delta = sum - (d.closingBalance - d.openingBalance)
      recCol = Math.abs(delta) < 0.01 ? '✓' : `✗ Δ ${formatAmount(delta)}`
    } else recCol = '—'

    const txnCol = d.ok ? `✓ ${d.transactions.length}` : '✗ —'
    return {
      fixture: d.filename,
      format: d.format,
      txns: txnCol,
      inv: invCol,
      rec: recCol,
    }
  })

  const fixtureWidth = Math.max(colFixture.length, ...rows.map((r) => r.fixture.length))
  const formatWidth = Math.max(colFormat.length, ...rows.map((r) => r.format.length))
  const txnsWidth = Math.max(colTxns.length, ...rows.map((r) => r.txns.length))
  const invWidth = Math.max(colInv.length, ...rows.map((r) => r.inv.length))
  const recWidth = Math.max(colRec.length, ...rows.map((r) => r.rec.length))

  const fmt = (f: string, fmtL: string, t: string, i: string, r: string) =>
    `${f.padEnd(fixtureWidth)}  ${fmtL.padEnd(formatWidth)}  ${t.padEnd(txnsWidth)}  ${i.padEnd(invWidth)}  ${r.padEnd(recWidth)}`

  const out: string[] = []
  out.push('=== SUMMARY ===')
  out.push(fmt(colFixture, colFormat, colTxns, colInv, colRec))
  out.push(fmt('-'.repeat(fixtureWidth), '-'.repeat(formatWidth), '-'.repeat(txnsWidth), '-'.repeat(invWidth), '-'.repeat(recWidth)))
  for (const r of rows) out.push(fmt(r.fixture, r.format, r.txns, r.inv, r.rec))
  out.push('')
  return out.join('\n')
}
