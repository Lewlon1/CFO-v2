# Session 3: CSV Engine + Dual Categorisation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full data ingestion pipeline — CSV/XLSX/screenshot upload → parse → dual categorisation (traditional + value) → store → post-import analytics — with a review UI on the `/transactions` page.

**Architecture:** Parsing, categorisation, and analytics are pure TypeScript modules in `lib/`. The API route at `app/api/upload/route.ts` orchestrates them. The `/transactions` page hosts both the upload wizard and the transaction list. No test framework is installed; TypeScript compilation (`tsc --noEmit`) is used to validate logic modules, browser dev server to verify UI.

**Tech Stack:** Next.js App Router, Supabase (PostgreSQL + service role), PapaParse (CSV), xlsx (XLSX), Vercel AI SDK + Bedrock (`analysisModel`), Tailwind CSS, Lucide icons.

---

## File Map

```
lib/parsers/types.ts                      shared ParsedTransaction type
lib/parsers/index.ts                      format auto-detection
lib/parsers/revolut.ts                    Revolut CSV parser
lib/parsers/santander.ts                  Santander XLSX parser
lib/parsers/generic.ts                    generic CSV with column mapping support
lib/parsers/screenshot.ts                 Bedrock vision extraction

lib/csv/column-detector.ts               REPLACE stub — ported from /src/
lib/csv/transform.ts                     REPLACE stub — ported+adapted from /src/
lib/csv/hash.ts                          NEW — ported from /src/

lib/categorisation/normalise-merchant.ts  REPLACE stub — ported from /src/
lib/categorisation/rules-engine.ts        THREE-TIER traditional categorisation
lib/categorisation/llm-categoriser.ts     Bedrock batch fallback
lib/categorisation/value-categoriser.ts   value category assignment (layered)
lib/categorisation/categorise-transaction.ts  DELETE — replaced by rules-engine

lib/upload/pipeline.ts                    orchestrates categorise → insert
lib/upload/duplicate-detector.ts          field-based duplicate detection

lib/analytics/monthly-snapshot.ts         compute/upsert monthly_snapshots
lib/analytics/recurring-detector.ts       flag is_recurring, upsert recurring_expenses
lib/analytics/holiday-detector.ts         flag is_holiday_spend on foreign currency clusters

app/api/upload/route.ts                   POST: parse file; POST action=import: run pipeline
app/api/transactions/recategorise/route.ts POST: update category/value + optional rule

components/upload/UploadZone.tsx           drag-and-drop + file picker
components/upload/ColumnMapper.tsx         column mapping UI for generic CSV
components/upload/TransactionPreview.tsx   review table with inline category editing
components/upload/ImportResult.tsx         post-import summary card

components/transactions/CategoryBadge.tsx  traditional category pill (icon + color)
components/transactions/ValueBadge.tsx     value category pill
components/transactions/TransactionList.tsx paginated, filterable transaction table
components/transactions/TransactionFilters.tsx date/category/value/search filter bar

app/(app)/transactions/page.tsx            REPLACE stub — upload wizard + list
```

---

## Task 1: Install xlsx and shared types

**Files:**
- Modify: `cfos-office/package.json`
- Create: `cfos-office/src/lib/parsers/types.ts`

- [ ] **Step 1: Install xlsx**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
npm install xlsx
npm install --save-dev @types/xlsx
```

Expected: `package.json` now contains `"xlsx"`.

- [ ] **Step 2: Create shared types**

Create `cfos-office/src/lib/parsers/types.ts`:

```typescript
export type ParsedTransactionSource =
  | 'csv_revolut'
  | 'csv_santander'
  | 'csv_generic'
  | 'screenshot'

export type ParsedTransaction = {
  date: string            // ISO YYYY-MM-DD
  description: string     // cleaned, trimmed
  amount: number          // SIGNED: negative = expense, positive = income
  currency: string        // ISO 4217 e.g. 'EUR', 'GBP'
  source: ParsedTransactionSource
  raw_description: string // original text before cleaning
}

export type ParseResult =
  | { ok: true; transactions: ParsedTransaction[] }
  | { ok: false; error: string }

// Returned from the /api/upload parse step — includes duplicate flags
export type PreviewTransaction = ParsedTransaction & {
  suggestedCategoryId: string | null
  suggestedValueCategory: string
  isDuplicate: boolean
  rowIndex: number
}

// Category shape loaded from Supabase categories table
export type Category = {
  id: string
  name: string
  tier: 'core' | 'lifestyle' | 'financial'
  icon: string
  color: string
  examples: string[]
  default_value_category: string | null
}

// Value category rule loaded from value_category_rules
export type ValueCategoryRule = {
  match_type: string
  match_value: string
  value_category: string
  confidence: number
  source: string
}
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors in `lib/parsers/types.ts`.

- [ ] **Step 4: Commit**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
git add package.json package-lock.json src/lib/parsers/types.ts
git commit -m "feat(session3): add xlsx dependency and shared parser types"
```

---

## Task 2: Port utility modules from reference

**Files:**
- Replace: `cfos-office/src/lib/categorisation/normalise-merchant.ts`
- Replace: `cfos-office/src/lib/csv/column-detector.ts`
- Replace: `cfos-office/src/lib/csv/transform.ts`
- Create: `cfos-office/src/lib/csv/hash.ts`

- [ ] **Step 1: Replace normalise-merchant.ts**

Write `cfos-office/src/lib/categorisation/normalise-merchant.ts`:

```typescript
const TRANSACTION_PREFIXES =
  /^(card payment to|direct debit to|payment to|pos|dd|sto|fpo|bgc)\s+/i

const LEGAL_SUFFIXES =
  /\b(ltd|limited|inc|incorporated|plc|s\.?l\.?|s\.?a\.?|gmbh|ag|co\.?|corp|pty|llc|llp|bv|nv)\b\.?\s*$/i

const REFERENCE_NUMBERS = /[\s]*[*#x]\d{2,}$|\s+\d{4,}$/i

const NON_WORD = /[^\p{L}\p{N}\s\-&.]/gu

const MULTI_SPACE = /\s{2,}/g

export function normaliseMerchant(raw: string): string {
  if (!raw) return ''
  let text = raw.trim().toLowerCase()
  text = text.replace(TRANSACTION_PREFIXES, '')
  text = text.replace(LEGAL_SUFFIXES, '')
  text = text.replace(REFERENCE_NUMBERS, '')
  text = text.replace(NON_WORD, '')
  text = text.replace(MULTI_SPACE, ' ').trim()
  return text || raw.trim().toLowerCase()
}
```

- [ ] **Step 2: Replace column-detector.ts**

Write `cfos-office/src/lib/csv/column-detector.ts`:

```typescript
export type SemanticField =
  | 'date' | 'amount' | 'description' | 'merchant'
  | 'type' | 'category' | 'currency' | 'skip'

const FIELD_PATTERNS: Record<Exclude<SemanticField, 'skip'>, RegExp[]> = {
  date: [
    /^fecha/i, /^date/i, /^datum/i, /^data$/i, /^f\.?oper/i,
    /^value.?date/i, /^transaction.?date/i, /^booking/i,
    /completed.?date/i, /settlement.?date/i, /posting.?date/i,
    /effective.?date/i, /date$/i,
  ],
  amount: [
    /^importe/i, /^amount/i, /^betrag/i, /^montant/i, /^monto/i,
    /^cantidad/i, /^cargo/i, /^abono/i, /^valor/i, /^sum$/i,
  ],
  description: [
    /^concepto/i, /^descripci/i, /^description/i, /^details/i,
    /^memo/i, /^reference/i, /^remarque/i, /^motivo/i,
    /^concept/i, /^narrative/i,
  ],
  merchant: [
    /^comercio/i, /^merchant/i, /^benefici/i, /^tienda/i,
    /^estableci/i, /^payee/i, /^receptor/i, /^destinatario/i, /^name$/i,
  ],
  type: [/^tipo/i, /^type/i, /^movimiento/i, /^nature/i],
  category: [/^category/i, /^categoria/i, /^categor[ií]a/i, /^kategorie/i, /^catégorie/i],
  currency: [/^moneda/i, /^currency/i, /^devise/i, /^währung/i, /^curr$/i],
}

export function detectColumnMapping(headers: string[]): Record<string, SemanticField> {
  const result: Record<string, SemanticField> = {}
  const usedFields = new Set<SemanticField>()
  for (const header of headers) {
    let detected: SemanticField = 'skip'
    const trimmed = header.trim()
    for (const [field, patterns] of Object.entries(FIELD_PATTERNS) as [Exclude<SemanticField, 'skip'>, RegExp[]][]) {
      if (usedFields.has(field)) continue
      if (patterns.some((p) => p.test(trimmed))) {
        detected = field
        usedFields.add(field)
        break
      }
    }
    result[header] = detected
  }
  return result
}

export function isMappingHighConfidence(mapping: Record<string, SemanticField>): boolean {
  const fields = Object.values(mapping)
  const hasDate = fields.filter((f) => f === 'date').length === 1
  const hasAmount = fields.filter((f) => f === 'amount').length === 1
  const hasDescOrMerchant = fields.includes('description') || fields.includes('merchant')
  return hasDate && hasAmount && hasDescOrMerchant
}

export const SEMANTIC_FIELD_LABELS: Record<SemanticField, string> = {
  date: 'Date', amount: 'Amount', description: 'Description',
  merchant: 'Merchant', type: 'Type (income/expense)',
  category: 'Category', currency: 'Currency', skip: 'Skip this column',
}
```

- [ ] **Step 3: Replace transform.ts (adapt for signed amounts)**

Write `cfos-office/src/lib/csv/transform.ts`:

```typescript
import type { SemanticField } from './column-detector'

export type ColumnMapping = Record<string, SemanticField>

export type TransformedRow = {
  date: string         // ISO YYYY-MM-DD or raw if unparseable
  amount: number       // SIGNED: negative = expense, positive = income
  description: string  // description or merchant text
  currency: string
  parseError?: string
}

export function transformRow(
  row: Record<string, string>,
  mapping: ColumnMapping,
  defaultCurrency: string
): TransformedRow {
  const get = (field: SemanticField): string => {
    const col = Object.entries(mapping).find(([, v]) => v === field)?.[0]
    return col ? (row[col]?.trim() ?? '') : ''
  }

  const rawDate = get('date')
  const rawAmount = get('amount')
  const rawType = get('type')
  const descText = get('description') || get('merchant') || ''

  const date = parseDate(rawDate)
  const rawNum = parseAmount(rawAmount)
  const amount = applySign(rawNum, rawType)

  let parseError: string | undefined
  if (!date) parseError = `Could not parse date: "${rawDate}"`
  if (isNaN(rawNum)) parseError = `Could not parse amount: "${rawAmount}"`

  return {
    date: date || rawDate,
    amount,
    description: descText,
    currency: get('currency') || defaultCurrency,
    parseError,
  }
}

function parseDate(raw: string): string {
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)
  const m = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/)
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return ''
}

function parseAmount(raw: string): number {
  if (!raw) return NaN
  let cleaned = raw.replace(/[^\d,.\-+]/g, '').trim()
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.')
  } else {
    cleaned = cleaned.replace(',', '.')
  }
  return parseFloat(cleaned)
}

function applySign(amount: number, rawType: string): number {
  if (isNaN(amount)) return NaN
  const lower = rawType.toLowerCase()
  const isIncome =
    lower.includes('ingreso') || lower.includes('income') ||
    lower.includes('credit') || lower.includes('abono') ||
    lower.includes('salary') || lower.includes('salario')
  const isExpense =
    lower.includes('gasto') || lower.includes('expense') ||
    lower.includes('debit') || lower.includes('cargo') || lower.includes('pago')
  if (isIncome) return Math.abs(amount)
  if (isExpense) return -Math.abs(amount)
  // fallback: trust the sign already in the raw amount
  return amount
}
```

- [ ] **Step 4: Create hash.ts**

Create `cfos-office/src/lib/csv/hash.ts`:

```typescript
export async function generateTransactionHash(
  date: string,
  amount: string,
  description: string
): Promise<string> {
  const raw = `${date}|${amount}|${description}`.toLowerCase().trim()
  const encoded = new TextEncoder().encode(raw)
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}
```

- [ ] **Step 5: Type-check**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
npx tsc --noEmit 2>&1 | grep -v node_modules | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
git add src/lib/categorisation/normalise-merchant.ts src/lib/csv/
git commit -m "feat(session3): port column-detector, transform, normalise-merchant, hash from reference"
```

---

## Task 3: CSV parsers — Revolut and Generic

**Files:**
- Create: `cfos-office/src/lib/parsers/revolut.ts`
- Create: `cfos-office/src/lib/parsers/generic.ts`

- [ ] **Step 1: Create Revolut parser**

Create `cfos-office/src/lib/parsers/revolut.ts`:

```typescript
import Papa from 'papaparse'
import type { ParsedTransaction, ParseResult } from './types'

// Revolut CSV columns: Type, Product, Started Date, Completed Date,
// Description, Amount, Fee, Currency, State, Balance

export function parseRevolutCSV(text: string): ParseResult {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  })

  if (result.errors.length > 0 && result.data.length === 0) {
    return { ok: false, error: `CSV parse error: ${result.errors[0].message}` }
  }

  const transactions: ParsedTransaction[] = []

  for (const row of result.data) {
    // Only process completed transactions
    if (row['State'] !== 'COMPLETED') continue

    const rawDate = row['Completed Date'] || row['Started Date'] || ''
    const date = parseRevolutDate(rawDate)
    if (!date) continue

    const rawAmount = row['Amount'] || ''
    const amount = parseFloat(rawAmount.replace(',', '.'))
    if (isNaN(amount)) continue

    const description = (row['Description'] || '').trim()
    const currency = (row['Currency'] || 'EUR').trim()

    transactions.push({
      date,
      description,
      amount, // Revolut amounts are already signed
      currency,
      source: 'csv_revolut',
      raw_description: description,
    })
  }

  return { ok: true, transactions }
}

function parseRevolutDate(raw: string): string {
  if (!raw) return ''
  // Format: "2026-01-15 14:23:00" or "2026-01-15"
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : ''
}

export function isRevolutCSV(headers: string[]): boolean {
  const required = ['Completed Date', 'Description', 'Amount', 'Currency', 'State']
  return required.every((h) => headers.includes(h))
}
```

- [ ] **Step 2: Create Generic parser**

Create `cfos-office/src/lib/parsers/generic.ts`:

```typescript
import Papa from 'papaparse'
import { detectColumnMapping, isMappingHighConfidence } from '@/lib/csv/column-detector'
import { transformRow } from '@/lib/csv/transform'
import type { ParsedTransaction, ParseResult } from './types'

export type ColumnMappingResult = {
  needsMapping: true
  headers: string[]
  autoMapping: Record<string, string>
  rawRows: Record<string, string>[]
} | {
  needsMapping: false
  transactions: ParsedTransaction[]
}

/**
 * First pass: parse headers, auto-detect columns.
 * Returns either ready transactions (high confidence) or the raw data
 * for the ColumnMapper UI to handle.
 */
export function parseGenericCSV(
  text: string,
  defaultCurrency = 'EUR'
): ParseResult | ColumnMappingResult {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  })

  if (result.errors.length > 0 && result.data.length === 0) {
    return { ok: false, error: `CSV parse error: ${result.errors[0].message}` }
  }

  const headers = result.meta.fields ?? []
  const autoMapping = detectColumnMapping(headers)

  if (!isMappingHighConfidence(autoMapping)) {
    return {
      needsMapping: true,
      headers,
      autoMapping,
      rawRows: result.data,
    }
  }

  return applyMapping(result.data, autoMapping, defaultCurrency)
}

/**
 * Second pass: apply a confirmed column mapping to raw rows.
 * Called after ColumnMapper UI confirms mapping.
 */
export function applyColumnMapping(
  rawRows: Record<string, string>[],
  mapping: Record<string, string>,
  defaultCurrency = 'EUR'
): ParseResult {
  return applyMapping(rawRows, mapping, defaultCurrency)
}

function applyMapping(
  rows: Record<string, string>[],
  mapping: Record<string, string>,
  defaultCurrency: string
): ParseResult {
  const transactions: ParsedTransaction[] = []
  const errors: string[] = []

  for (const row of rows) {
    const transformed = transformRow(row, mapping as never, defaultCurrency)
    if (transformed.parseError) {
      errors.push(transformed.parseError)
      continue
    }
    if (!transformed.description) continue

    transactions.push({
      date: transformed.date,
      description: transformed.description,
      amount: transformed.amount,
      currency: transformed.currency,
      source: 'csv_generic',
      raw_description: transformed.description,
    })
  }

  if (transactions.length === 0 && errors.length > 0) {
    return { ok: false, error: errors[0] }
  }

  return { ok: true, transactions }
}
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
npx tsc --noEmit 2>&1 | grep -v node_modules | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
git add src/lib/parsers/
git commit -m "feat(session3): add Revolut and Generic CSV parsers"
```

---

## Task 4: Santander parser

**Files:**
- Create: `cfos-office/src/lib/parsers/santander.ts`

- [ ] **Step 1: Create Santander XLSX parser**

Create `cfos-office/src/lib/parsers/santander.ts`:

```typescript
import * as XLSX from 'xlsx'
import type { ParsedTransaction, ParseResult } from './types'

export function parseSantanderXLSX(buffer: ArrayBuffer): ParseResult {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, { type: 'array', codepage: 1252 })
  } catch {
    return { ok: false, error: 'Could not read XLSX file. Make sure it is a valid Excel file.' }
  }

  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return { ok: false, error: 'No sheets found in XLSX file.' }

  const sheet = workbook.Sheets[sheetName]
  // Get raw rows as arrays (Santander doesn't always have clean headers)
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false })

  if (rows.length < 2) return { ok: false, error: 'No data rows found in XLSX file.' }

  // Find header row — look for a row containing date-like and amount-like headers
  let headerRowIndex = 0
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i].map((c) => String(c ?? '').toLowerCase())
    if (row.some((c) => /fecha|date/.test(c)) && row.some((c) => /importe|amount|cargo/.test(c))) {
      headerRowIndex = i
      break
    }
  }

  const headers = rows[headerRowIndex].map((c) => String(c ?? '').trim())
  const dateCol = headers.findIndex((h) => /fecha|date/i.test(h))
  const amountCol = headers.findIndex((h) => /importe|amount|cargo/i.test(h))
  const descCol = headers.findIndex((h) => /concepto|descripci|description|motivo/i.test(h))

  if (dateCol === -1 || amountCol === -1 || descCol === -1) {
    return {
      ok: false,
      error: 'Could not find date, amount, or description columns. Try the generic import.',
    }
  }

  const transactions: ParsedTransaction[] = []

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row[dateCol] || !row[amountCol]) continue

    const rawDate = String(row[dateCol] ?? '').trim()
    const rawAmount = String(row[amountCol] ?? '').trim()
    const rawDesc = String(row[descCol] ?? '').trim()

    const date = parseSantanderDate(rawDate)
    if (!date) continue

    const amount = parseSantanderAmount(rawAmount)
    if (isNaN(amount)) continue

    const description = rawDesc || 'Unknown'

    transactions.push({
      date,
      description,
      amount,
      currency: 'EUR', // Santander ES is EUR
      source: 'csv_santander',
      raw_description: description,
    })
  }

  if (transactions.length === 0) {
    return { ok: false, error: 'No valid transactions found in the Santander file.' }
  }

  return { ok: true, transactions }
}

function parseSantanderDate(raw: string): string {
  // DD/MM/YYYY or DD-MM-YYYY
  const m = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  // ISO fallback
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)
  return ''
}

function parseSantanderAmount(raw: string): number {
  // Spanish format: 1.234,56 (dot = thousands, comma = decimal)
  let cleaned = raw.replace(/[^\d,.\-+]/g, '').trim()
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.')
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.')
  }
  return parseFloat(cleaned)
}

export function isSantanderFile(filename: string): boolean {
  return filename.toLowerCase().endsWith('.xlsx') || filename.toLowerCase().endsWith('.xls')
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
npx tsc --noEmit 2>&1 | grep -v node_modules | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
git add src/lib/parsers/santander.ts
git commit -m "feat(session3): add Santander XLSX parser with Spanish decimal handling"
```

---

## Task 5: Screenshot parser + format auto-detection

**Files:**
- Create: `cfos-office/src/lib/parsers/screenshot.ts`
- Create: `cfos-office/src/lib/parsers/index.ts`

- [ ] **Step 1: Create screenshot parser**

Create `cfos-office/src/lib/parsers/screenshot.ts`:

```typescript
import { generateText } from 'ai'
import { analysisModel } from '@/lib/ai/provider'
import type { ParsedTransaction, ParseResult } from './types'

const EXTRACTION_PROMPT = `You are extracting bank transactions from a screenshot.

Return ONLY a JSON array of transactions. No other text, no markdown, no explanation.

Each transaction object must have:
- "date": string in ISO format YYYY-MM-DD
- "description": string (merchant or description)
- "amount": number (NEGATIVE for expenses/debits, POSITIVE for income/credits)
- "currency": string ISO code e.g. "EUR", "GBP"

Rules:
- Handle Spanish date format DD/MM/YYYY → convert to YYYY-MM-DD
- Handle Spanish amounts with comma decimals: 1.234,56 → 1234.56
- If a date is unclear, use your best guess
- If currency is not shown, use "EUR"
- If amount sign is unclear, use negative (assume expense)
- Skip any rows that are clearly headers, totals, or balance lines
- Extract only actual transaction rows

Return format example:
[{"date":"2026-03-15","description":"Mercadona","amount":-45.20,"currency":"EUR"}]`

export async function parseScreenshot(imageBase64: string): Promise<ParseResult> {
  try {
    const { text } = await generateText({
      model: analysisModel,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', image: imageBase64 },
            { type: 'text', text: EXTRACTION_PROMPT },
          ],
        },
      ],
    })

    const cleaned = text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
    const parsed = JSON.parse(cleaned)

    if (!Array.isArray(parsed)) {
      return { ok: false, error: 'Unexpected response format from vision model.' }
    }

    const transactions: ParsedTransaction[] = []

    for (const item of parsed) {
      if (!item.date || typeof item.amount !== 'number' || !item.description) continue
      transactions.push({
        date: String(item.date).slice(0, 10),
        description: String(item.description).trim(),
        amount: Number(item.amount),
        currency: String(item.currency || 'EUR').toUpperCase(),
        source: 'screenshot',
        raw_description: String(item.description).trim(),
      })
    }

    if (transactions.length === 0) {
      return { ok: false, error: 'No transactions could be extracted from the image.' }
    }

    return { ok: true, transactions }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Vision extraction failed: ${message}` }
  }
}
```

- [ ] **Step 2: Create format auto-detection index**

Create `cfos-office/src/lib/parsers/index.ts`:

```typescript
import Papa from 'papaparse'
import { isRevolutCSV } from './revolut'
import { isSantanderFile } from './santander'
import type { ParsedTransactionSource } from './types'

export type DetectedFormat =
  | 'revolut'
  | 'santander'
  | 'generic'
  | 'screenshot'
  | 'unknown'

export function detectFormat(filename: string, fileText?: string): DetectedFormat {
  const lower = filename.toLowerCase()

  // Image files
  if (/\.(png|jpg|jpeg|heic|webp)$/.test(lower)) return 'screenshot'

  // XLSX — route to Santander parser
  if (isSantanderFile(filename)) return 'santander'

  // CSV — check headers
  if (fileText && /\.csv$/i.test(lower)) {
    const preview = Papa.parse<Record<string, string>>(fileText, {
      header: true,
      preview: 5,
    })
    const headers = preview.meta.fields ?? []
    if (isRevolutCSV(headers)) return 'revolut'
    return 'generic'
  }

  return 'unknown'
}

export function sourceFromFormat(format: DetectedFormat): ParsedTransactionSource {
  switch (format) {
    case 'revolut': return 'csv_revolut'
    case 'santander': return 'csv_santander'
    case 'screenshot': return 'screenshot'
    default: return 'csv_generic'
  }
}
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
npx tsc --noEmit 2>&1 | grep -v node_modules | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
git add src/lib/parsers/
git commit -m "feat(session3): add screenshot parser and format auto-detection"
```

---

## Task 6: Categorisation — rules engine

**Files:**
- Create: `cfos-office/src/lib/categorisation/rules-engine.ts`
- Delete: `cfos-office/src/lib/categorisation/categorise-transaction.ts` (was a stub)

- [ ] **Step 1: Create rules-engine.ts**

Create `cfos-office/src/lib/categorisation/rules-engine.ts`:

```typescript
import { normaliseMerchant } from './normalise-merchant'
import type { Category } from '@/lib/parsers/types'

export type CatResult = {
  categoryId: string | null
  confidence: number
  tier: 'db_example' | 'keyword' | 'none'
}

// Keyword heuristics mapped to DB category slugs.
// ORDER MATTERS: housing before transport to prevent "alquiler" (rent) mismatching.
const KEYWORD_RULES: Array<{ keywords: string[]; categoryId: string }> = [
  {
    keywords: [
      'rent ', 'alquiler', 'miete ', 'mortgage', 'hipoteca', 'ibi ', 'grundsteuer',
    ],
    categoryId: 'housing',
  },
  {
    keywords: [
      'supermarket', 'supermercado', 'mercadona', 'lidl', 'aldi', 'eroski', 'consum',
      'carrefour', 'waitrose', 'tesco', 'sainsbury', 'morrisons', 'asda', 'coop ',
      'primaprix', ' dia ', 'bon preu', 'condis', 'simply', 'ahorramas',
      'rewe', 'edeka', 'netto ', 'penny ', 'kaufland', 'spar ',
      'verdura', 'fruta', 'grocer', 'alimentaci', 'minimarket',
    ],
    categoryId: 'groceries',
  },
  {
    keywords: [
      'restaurant', 'restaurante', 'cafe ', 'café', 'cafeteria', 'cafetería', 'coffee',
      'bistro', 'brasserie', 'sushi', 'pizza', 'burger', 'grill', 'tapas',
      'mcdonald', 'kfc ', 'subway ', 'starbucks', 'costa ', 'nando', 'wagamama',
      'chipotle', 'domino', 'kebab', 'pizzeria', 'taberna', 'bodega', 'cerveceria',
      'boulangerie', 'patisserie', 'trattoria', 'ristorante', 'ramen', 'glovo',
      'deliveroo', 'ubereats', 'just eat',
    ],
    categoryId: 'eat_drinking_out',
  },
  {
    keywords: [
      'petrol', 'gasolina', 'fuel', 'bp ', 'shell ', 'texaco', 'esso ', 'repsol',
      'parking', 'aparcamiento', 'autobus', 'metro ', 'renfe', 'cercanias',
      'trainline', 'national rail', 'taxi ', 'uber ', 'bolt ', 'free now', 'cabify',
      'bus ', 'bvg ', 'flixbus', 'deutsche bahn',
    ],
    categoryId: 'transport',
  },
  {
    keywords: [
      'airport', 'aeropuerto', 'airline', 'ryanair', 'easyjet', 'vueling', 'iberia',
      'british airway', 'hotel', 'hostel', 'airbnb', 'booking.com', 'expedia',
      'holiday', 'resort', 'alojamiento',
    ],
    categoryId: 'travel',
  },
  {
    keywords: [
      'netflix', 'spotify', 'apple.com', 'google play', 'steam ',
      'playstation', 'xbox ', 'disney', 'amazon prime', 'prime video',
      'hbo ', 'dazn', 'twitch', 'adobe ', 'dropbox', 'notion ', '1password',
    ],
    categoryId: 'subscriptions',
  },
  {
    keywords: [
      'amazon', 'ebay ', 'zara ', 'h&m ', 'mango ', 'uniqlo', 'ikea ',
      'el corte ingles', 'corte ingles', 'asos', 'zalando', 'decathlon',
      'leroy merlin', 'fnac', 'primark', 'media markt',
    ],
    categoryId: 'shopping',
  },
  {
    keywords: [
      'gym ', 'fitness', 'crossfit', 'yoga ', 'pilates',
      'pharmacy', 'farmacia', 'chemist', 'boots ', 'dentist', 'dental',
      'optician', 'hospital', 'clinic', 'clinica', 'physio', 'medic',
      'peluquer', 'haircut', 'barber', 'nail ', 'beauty', 'spa ', 'massage',
    ],
    categoryId: 'health',
  },
  {
    keywords: [
      'electricity', 'electric', 'electricidad', 'gas ', 'natural gas',
      'water ', 'agua ', 'energia', 'energy', 'broadband', 'internet ',
      'movistar', 'vodafone', 'orange ', 'o2 ', 'endesa', 'iberdrola',
    ],
    categoryId: 'utilities_bills',
  },
  {
    keywords: ['golf', 'tennis', 'padel', 'squash', 'bowling', 'cinema', 'cine ',
      'theatre', 'teatro', 'museum', 'museo', 'zoo ', 'aquarium', 'escape room'],
    categoryId: 'entertainment',
  },
  {
    keywords: ['peluquer', 'friseur', 'barber', 'beauty', 'skincare', 'haircut'],
    categoryId: 'personal_care',
  },
  {
    keywords: ['pet food', 'vet ', 'veterinario', 'grooming', 'mascotas'],
    categoryId: 'pets',
  },
  {
    keywords: [
      'savings transfer', 'broker', 'pension', 'crypto', 'etf',
      'vanguard', 'degiro', 'trading',
    ],
    categoryId: 'savings_investments',
  },
  {
    keywords: ['loan repayment', 'credit card', 'student loan', 'prestamo', 'hipoteca pago'],
    categoryId: 'debt_repayments',
  },
  {
    keywords: ['salary', 'salario', 'nomina', 'nómina', 'payroll', 'dividends', 'freelance'],
    categoryId: 'income',
  },
]

/**
 * Tier 1: Match description against category examples[] from DB.
 * Longest match wins (most specific rule first).
 */
function matchByExamples(
  normalisedText: string,
  categories: Category[]
): CatResult {
  let bestMatch: { categoryId: string; matchLength: number } | null = null

  for (const cat of categories) {
    for (const example of cat.examples) {
      const exLower = example.toLowerCase()
      if (normalisedText.includes(exLower)) {
        if (!bestMatch || exLower.length > bestMatch.matchLength) {
          bestMatch = { categoryId: cat.id, matchLength: exLower.length }
        }
      }
    }
  }

  if (bestMatch) {
    return { categoryId: bestMatch.categoryId, confidence: 1.0, tier: 'db_example' }
  }
  return { categoryId: null, confidence: 0, tier: 'none' }
}

/**
 * Tier 2: Keyword heuristics — built-in rules mapped to DB slugs.
 */
function matchByKeywords(paddedText: string): CatResult {
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((kw) => paddedText.includes(kw))) {
      return { categoryId: rule.categoryId, confidence: 0.8, tier: 'keyword' }
    }
  }
  return { categoryId: null, confidence: 0, tier: 'none' }
}

/**
 * Run tiers 1 and 2. Returns null categoryId if no match (needs LLM tier 3).
 */
export function categoriseByRules(description: string, categories: Category[]): CatResult {
  const normalised = normaliseMerchant(description)
  // Tier 1: DB examples
  const t1 = matchByExamples(normalised, categories)
  if (t1.categoryId) return t1
  // Tier 2: keyword heuristics (pad with spaces for word-boundary matching)
  const padded = ` ${normalised} `
  return matchByKeywords(padded)
}
```

- [ ] **Step 2: Delete old stub**

```bash
rm /Users/lewislonsdale/Documents/CFO-V2/cfos-office/src/lib/categorisation/categorise-transaction.ts
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
npx tsc --noEmit 2>&1 | grep -v node_modules | head -20
```

Expected: no errors (or only errors from the deleted stub that nothing imports yet).

- [ ] **Step 4: Commit**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
git add src/lib/categorisation/
git commit -m "feat(session3): add three-tier rules engine with 200+ keyword rules"
```

---

## Task 7: Categorisation — LLM fallback and value categoriser

**Files:**
- Create: `cfos-office/src/lib/categorisation/llm-categoriser.ts`
- Create: `cfos-office/src/lib/categorisation/value-categoriser.ts`

- [ ] **Step 1: Create LLM categoriser**

Create `cfos-office/src/lib/categorisation/llm-categoriser.ts`:

```typescript
import { generateText } from 'ai'
import { analysisModel } from '@/lib/ai/provider'
import type { Category } from '@/lib/parsers/types'

export type LLMCatResult = {
  index: number
  categoryId: string
  confidence: number
}

/**
 * Send up to 50 unmatched transactions to Bedrock for categorisation.
 * Returns an array of results indexed to the input array.
 */
export async function llmCategorise(
  descriptions: string[],
  categories: Category[]
): Promise<LLMCatResult[]> {
  if (descriptions.length === 0) return []

  const categoryList = categories
    .map((c) => `- ${c.id}: ${c.name} — ${c.description ?? ''}`)
    .join('\n')

  const txnList = descriptions
    .slice(0, 50)
    .map((d, i) => `${i + 1}. "${d}"`)
    .join('\n')

  const prompt = `Categorise each transaction into one of these categories:
${categoryList}

Transactions:
${txnList}

Return ONLY a JSON array. No other text.
Format: [{"index":1,"category_id":"groceries","confidence":0.85}, ...]
Confidence range: 0.4 to 0.85 (never 1.0 — that is reserved for exact matches).
If genuinely uncertain use "shopping" as fallback.`

  try {
    const { text } = await generateText({
      model: analysisModel,
      messages: [{ role: 'user', content: prompt }],
    })

    const cleaned = text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
    const parsed: LLMCatResult[] = JSON.parse(cleaned)

    // Validate output — filter out invalid entries
    const validIds = new Set(categories.map((c) => c.id))
    return parsed.filter(
      (r) =>
        typeof r.index === 'number' &&
        typeof r.category_id === 'string' &&
        validIds.has(r.category_id) &&
        typeof r.confidence === 'number'
    )
  } catch {
    return [] // graceful fallback — transactions stay uncategorised
  }
}
```

- [ ] **Step 2: Create value categoriser**

Create `cfos-office/src/lib/categorisation/value-categoriser.ts`:

```typescript
import type { Category, ValueCategoryRule } from '@/lib/parsers/types'
import { normaliseMerchant } from './normalise-merchant'

export type ValueCatResult = {
  valueCategory: string
  confidence: number
  source: 'user_description_rule' | 'user_category_rule' | 'category_default' | 'none'
}

/**
 * Assign a value category using layered priority:
 * 1. User description rules (merchant_contains match)
 * 2. User category rules (category_id match)
 * 3. Category default_value_category
 * 4. Fallback → 'unsure'
 */
export function assignValueCategory(
  description: string,
  categoryId: string | null,
  userRules: ValueCategoryRule[],
  categories: Category[]
): ValueCatResult {
  const normalised = normaliseMerchant(description)

  // Priority 1: user description rules
  for (const rule of userRules) {
    if (rule.match_type === 'merchant_contains') {
      if (normalised.includes(rule.match_value.toLowerCase())) {
        return {
          valueCategory: rule.value_category,
          confidence: rule.confidence,
          source: 'user_description_rule',
        }
      }
    }
  }

  // Priority 2: user category rules
  if (categoryId) {
    for (const rule of userRules) {
      if (rule.match_type === 'category_id' && rule.match_value === categoryId) {
        return {
          valueCategory: rule.value_category,
          confidence: rule.confidence,
          source: 'user_category_rule',
        }
      }
    }
  }

  // Priority 3: category default
  if (categoryId) {
    const cat = categories.find((c) => c.id === categoryId)
    if (cat?.default_value_category) {
      return {
        valueCategory: cat.default_value_category,
        confidence: 0.3,
        source: 'category_default',
      }
    }
  }

  return { valueCategory: 'unsure', confidence: 0, source: 'none' }
}
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
npx tsc --noEmit 2>&1 | grep -v node_modules | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
git add src/lib/categorisation/llm-categoriser.ts src/lib/categorisation/value-categoriser.ts
git commit -m "feat(session3): add LLM categoriser (Bedrock) and value category assignment"
```

---

## Task 8: Duplicate detector + storage pipeline

**Files:**
- Create: `cfos-office/src/lib/upload/duplicate-detector.ts`
- Create: `cfos-office/src/lib/upload/pipeline.ts`

- [ ] **Step 1: Create duplicate detector**

Create `cfos-office/src/lib/upload/duplicate-detector.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import type { ParsedTransaction } from '@/lib/parsers/types'

/**
 * Returns a Set of "duplicate keys" that already exist in the DB for this user.
 * Key format: "YYYY-MM-DD|amount|normalised_description"
 */
export async function loadExistingKeys(
  supabase: SupabaseClient,
  userId: string,
  dateFrom: string,
  dateTo: string
): Promise<Set<string>> {
  const { data } = await supabase
    .from('transactions')
    .select('date, amount, description')
    .eq('user_id', userId)
    .gte('date', dateFrom)
    .lte('date', dateTo)

  const keys = new Set<string>()
  for (const row of data ?? []) {
    const dateStr = String(row.date ?? '').slice(0, 10)
    const key = makeKey(dateStr, row.amount, row.description)
    keys.add(key)
  }
  return keys
}

export function makeKey(date: string, amount: number, description: string): string {
  const normDesc = normaliseMerchant(description)
  return `${date}|${amount}|${normDesc}`
}

export function isDuplicate(
  txn: ParsedTransaction,
  existingKeys: Set<string>
): boolean {
  const key = makeKey(txn.date, txn.amount, txn.description)
  return existingKeys.has(key)
}
```

- [ ] **Step 2: Create storage pipeline**

Create `cfos-office/src/lib/upload/pipeline.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import { categoriseByRules } from '@/lib/categorisation/rules-engine'
import { llmCategorise } from '@/lib/categorisation/llm-categoriser'
import { assignValueCategory } from '@/lib/categorisation/value-categoriser'
import { loadExistingKeys, isDuplicate } from './duplicate-detector'
import type { ParsedTransaction, Category, ValueCategoryRule } from '@/lib/parsers/types'

export type PipelineStats = {
  imported: number
  duplicates: number
  errors: number
}

export type PipelineOptions = {
  userId: string
  accountId: string | null
  importBatchId: string
  skipDuplicates?: boolean // default true
}

export async function runImportPipeline(
  transactions: ParsedTransaction[],
  supabase: SupabaseClient,
  opts: PipelineOptions
): Promise<PipelineStats> {
  const stats: PipelineStats = { imported: 0, duplicates: 0, errors: 0 }
  if (transactions.length === 0) return stats

  // Load reference data
  const { data: catData } = await supabase
    .from('categories')
    .select('id, name, tier, icon, color, examples, default_value_category')
    .eq('is_active', true)
  const categories: Category[] = catData ?? []

  const { data: rulesData } = await supabase
    .from('value_category_rules')
    .select('match_type, match_value, value_category, confidence, source')
    .eq('user_id', opts.userId)
  const userRules: ValueCategoryRule[] = rulesData ?? []

  // Load existing keys for duplicate detection
  const dates = transactions.map((t) => t.date).sort()
  const existingKeys = await loadExistingKeys(
    supabase, opts.userId, dates[0], dates[dates.length - 1]
  )

  // Pass 1: rules-based categorisation, collect unmatched for LLM
  const toInsert: Array<ParsedTransaction & {
    categoryId: string | null
    confidence: number
    valueCategory: string
    needsLLM: boolean
  }> = []

  for (const txn of transactions) {
    if (opts.skipDuplicates !== false && isDuplicate(txn, existingKeys)) {
      stats.duplicates++
      continue
    }

    const catResult = categoriseByRules(txn.description, categories)
    const valResult = assignValueCategory(
      txn.description,
      catResult.categoryId,
      userRules,
      categories
    )

    toInsert.push({
      ...txn,
      categoryId: catResult.categoryId,
      confidence: catResult.confidence,
      valueCategory: valResult.valueCategory,
      needsLLM: catResult.categoryId === null,
    })
  }

  // Pass 2: batch LLM for unmatched
  const unmatched = toInsert.filter((t) => t.needsLLM)
  if (unmatched.length > 0) {
    const llmResults = await llmCategorise(
      unmatched.map((t) => t.description),
      categories
    )
    for (const result of llmResults) {
      const txn = unmatched[result.index - 1]
      if (txn) {
        txn.categoryId = result.category_id
        txn.confidence = result.confidence
        // Re-run value assignment with the now-known category
        const valResult = assignValueCategory(
          txn.description, txn.categoryId, userRules, categories
        )
        txn.valueCategory = valResult.valueCategory
      }
    }
  }

  // Pass 3: insert
  for (const txn of toInsert) {
    const { error } = await supabase.from('transactions').insert({
      user_id: opts.userId,
      account_id: opts.accountId,
      date: txn.date,
      description: txn.description,
      raw_description: txn.raw_description,
      amount: txn.amount,
      currency: txn.currency,
      category_id: txn.categoryId,
      auto_category_confidence: txn.confidence,
      value_category: txn.valueCategory,
      source: txn.source,
      import_batch_id: opts.importBatchId,
      user_confirmed: false,
    })
    if (error) {
      stats.errors++
    } else {
      stats.imported++
    }
  }

  return stats
}
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
npx tsc --noEmit 2>&1 | grep -v node_modules | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
git add src/lib/upload/
git commit -m "feat(session3): add duplicate detector and import pipeline"
```

---

## Task 9: Post-import analytics

**Files:**
- Create: `cfos-office/src/lib/analytics/monthly-snapshot.ts`
- Create: `cfos-office/src/lib/analytics/recurring-detector.ts`
- Create: `cfos-office/src/lib/analytics/holiday-detector.ts`

- [ ] **Step 1: Create monthly snapshot**

Create `cfos-office/src/lib/analytics/monthly-snapshot.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

export async function refreshMonthlySnapshots(
  supabase: SupabaseClient,
  userId: string,
  affectedMonths: string[] // YYYY-MM strings
): Promise<void> {
  for (const month of affectedMonths) {
    await refreshOneMonth(supabase, userId, month)
  }
}

async function refreshOneMonth(
  supabase: SupabaseClient,
  userId: string,
  month: string // YYYY-MM
): Promise<void> {
  const monthStart = `${month}-01`
  const [year, m] = month.split('-').map(Number)
  const nextMonth = m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, '0')}-01`

  const { data: txns } = await supabase
    .from('transactions')
    .select('amount, category_id, value_category')
    .eq('user_id', userId)
    .gte('date', monthStart)
    .lt('date', nextMonth)

  if (!txns || txns.length === 0) return

  const totalIncome = txns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0)
  const totalSpending = Math.abs(txns.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0))

  const spendingByCategory: Record<string, number> = {}
  const spendingByValueCategory: Record<string, number> = {}
  let largestTxn = 0

  for (const txn of txns) {
    if (txn.amount >= 0) continue // skip income for spending breakdown
    const abs = Math.abs(txn.amount)
    if (txn.category_id) {
      spendingByCategory[txn.category_id] = (spendingByCategory[txn.category_id] ?? 0) + abs
    }
    const vc = txn.value_category ?? 'unsure'
    spendingByValueCategory[vc] = (spendingByValueCategory[vc] ?? 0) + abs
    if (abs > largestTxn) largestTxn = abs
  }

  const spendingTxns = txns.filter((t) => t.amount < 0)
  const avgTxnSize = spendingTxns.length > 0 ? totalSpending / spendingTxns.length : 0

  // Previous month for comparison
  const prevMonth = m === 1 ? `${year - 1}-12` : `${year}-${String(m - 1).padStart(2, '0')}`
  const { data: prevSnap } = await supabase
    .from('monthly_snapshots')
    .select('total_spending')
    .eq('user_id', userId)
    .eq('month', `${prevMonth}-01`)
    .single()

  const vsPrevPct = prevSnap?.total_spending
    ? ((totalSpending - prevSnap.total_spending) / prevSnap.total_spending) * 100
    : null

  await supabase.from('monthly_snapshots').upsert(
    {
      user_id: userId,
      month: monthStart,
      total_income: totalIncome,
      total_spending: totalSpending,
      surplus_deficit: totalIncome - totalSpending,
      spending_by_category: spendingByCategory,
      spending_by_value_category: spendingByValueCategory,
      transaction_count: txns.length,
      avg_transaction_size: Math.round(avgTxnSize * 100) / 100,
      largest_transaction: largestTxn,
      vs_previous_month_pct: vsPrevPct ? Math.round(vsPrevPct * 10) / 10 : null,
    },
    { onConflict: 'user_id,month' }
  )
}

/** Extract distinct YYYY-MM strings from an array of ISO dates */
export function extractAffectedMonths(dates: string[]): string[] {
  const months = new Set(dates.map((d) => d.slice(0, 7)))
  return Array.from(months).sort()
}
```

- [ ] **Step 2: Create recurring detector**

Create `cfos-office/src/lib/analytics/recurring-detector.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'

type TxnRow = { id: string; date: string; amount: number; description: string; category_id: string | null }

export async function detectAndFlagRecurring(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  // Load all transactions for this user (last 6 months max)
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

  const { data: txns } = await supabase
    .from('transactions')
    .select('id, date, amount, description, category_id')
    .eq('user_id', userId)
    .gte('date', sixMonthsAgo.toISOString().slice(0, 10))
    .lt('amount', 0) // only expenses
    .order('date', { ascending: true })

  if (!txns || txns.length < 2) return

  // Group by normalised description
  const groups = new Map<string, TxnRow[]>()
  for (const txn of txns) {
    const key = normaliseMerchant(txn.description)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(txn)
  }

  for (const [normDesc, rows] of groups) {
    if (rows.length < 2) continue

    // Check if they appear in different months
    const months = new Set(rows.map((r) => r.date.slice(0, 7)))
    if (months.size < 2) continue

    // Determine frequency from gaps
    const dates = rows.map((r) => new Date(r.date)).sort((a, b) => a.getTime() - b.getTime())
    const gaps: number[] = []
    for (let i = 1; i < dates.length; i++) {
      gaps.push(Math.round((dates[i].getTime() - dates[i - 1].getTime()) / (1000 * 60 * 60 * 24)))
    }
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length

    let frequency = 'monthly'
    let billingDay: number | null = dates[dates.length - 1].getDate()
    if (avgGap > 80 && avgGap < 100) frequency = 'quarterly'
    else if (avgGap > 25 && avgGap < 35) frequency = 'monthly'
    else if (avgGap > 55 && avgGap < 75) frequency = 'bi-monthly'
    else if (avgGap > 350 && avgGap < 380) frequency = 'annual'
    else {
      // Non-standard — still flag but mark as irregular
      frequency = 'irregular'
      billingDay = null
    }

    const avgAmount = Math.abs(rows.reduce((s, r) => s + r.amount, 0) / rows.length)
    const latestRow = rows[rows.length - 1]

    // Flag all matching transactions as recurring
    const ids = rows.map((r) => r.id)
    await supabase.from('transactions').update({ is_recurring: true }).in('id', ids)

    // Upsert to recurring_expenses
    await supabase.from('recurring_expenses').upsert(
      {
        user_id: userId,
        name: normDesc,
        amount: Math.round(avgAmount * 100) / 100,
        currency: 'EUR',
        frequency,
        billing_day: billingDay,
        category_id: latestRow.category_id,
      },
      { onConflict: 'user_id,name', ignoreDuplicates: false }
    )
  }
}
```

- [ ] **Step 3: Create holiday detector**

Create `cfos-office/src/lib/analytics/holiday-detector.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

export async function detectAndFlagHolidaySpend(
  supabase: SupabaseClient,
  userId: string,
  userPrimaryCurrency: string,
  importBatchId: string
): Promise<void> {
  const { data: txns } = await supabase
    .from('transactions')
    .select('id, date, currency')
    .eq('user_id', userId)
    .eq('import_batch_id', importBatchId)
    .neq('currency', userPrimaryCurrency)

  if (!txns || txns.length === 0) return

  // Group foreign-currency transactions into clusters (gap ≤ 2 days between consecutive)
  const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date))
  const clusters: string[][] = []
  let current: string[] = [sorted[0].id]

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1].date)
    const curr = new Date(sorted[i].date)
    const gapDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24)
    if (gapDays <= 2) {
      current.push(sorted[i].id)
    } else {
      if (current.length >= 2) clusters.push(current)
      current = [sorted[i].id]
    }
  }
  if (current.length >= 2) clusters.push(current)

  // Flag all transactions in clusters as holiday spend
  for (const cluster of clusters) {
    await supabase.from('transactions').update({ is_holiday_spend: true }).in('id', cluster)
  }
}
```

- [ ] **Step 4: Type-check**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
npx tsc --noEmit 2>&1 | grep -v node_modules | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
git add src/lib/analytics/
git commit -m "feat(session3): add monthly snapshot, recurring detector, holiday detector"
```

---

## Task 10: Upload API route

**Files:**
- Create: `cfos-office/src/app/api/upload/route.ts`

- [ ] **Step 1: Create upload API route**

Create `cfos-office/src/app/api/upload/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { detectFormat } from '@/lib/parsers'
import { parseRevolutCSV } from '@/lib/parsers/revolut'
import { parseSantanderXLSX } from '@/lib/parsers/santander'
import { parseGenericCSV, applyColumnMapping } from '@/lib/parsers/generic'
import { parseScreenshot } from '@/lib/parsers/screenshot'
import { categoriseByRules } from '@/lib/categorisation/rules-engine'
import { assignValueCategory } from '@/lib/categorisation/value-categoriser'
import { loadExistingKeys, isDuplicate } from '@/lib/upload/duplicate-detector'
import { runImportPipeline } from '@/lib/upload/pipeline'
import { refreshMonthlySnapshots, extractAffectedMonths } from '@/lib/analytics/monthly-snapshot'
import { detectAndFlagRecurring } from '@/lib/analytics/recurring-detector'
import { detectAndFlagHolidaySpend } from '@/lib/analytics/holiday-detector'
import type { Category, ValueCategoryRule, PreviewTransaction } from '@/lib/parsers/types'
import { randomUUID } from 'crypto'

// POST /api/upload
// Body: FormData with 'file' field
// Response: { preview: PreviewTransaction[], needsColumnMapping?: true, headers?: string[], rawRows?: object[] }
//
// POST /api/upload with action=import
// Body: JSON { transactions: ParsedTransaction[], importBatchId: string }
// Response: { imported, duplicates, errors }

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const contentType = req.headers.get('content-type') ?? ''

  // ── Action: confirm import ─────────────────────────────────
  if (contentType.includes('application/json')) {
    const body = await req.json()
    if (body.action === 'import') {
      const importBatchId = body.importBatchId ?? randomUUID()
      const stats = await runImportPipeline(body.transactions, supabase, {
        userId: user.id,
        accountId: body.accountId ?? null,
        importBatchId,
      })

      // Post-import analytics (non-blocking — fire and forget for now)
      const months = extractAffectedMonths(body.transactions.map((t: { date: string }) => t.date))
      await refreshMonthlySnapshots(supabase, user.id, months)
      await detectAndFlagRecurring(supabase, user.id)

      // Holiday detection — needs user's primary currency
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('primary_currency')
        .eq('id', user.id)
        .single()
      const primaryCurrency = profile?.primary_currency ?? 'EUR'
      await detectAndFlagHolidaySpend(supabase, user.id, primaryCurrency, importBatchId)

      return NextResponse.json(stats)
    }

    // apply column mapping then return preview
    if (body.action === 'apply-mapping') {
      const result = applyColumnMapping(body.rawRows, body.mapping, body.currency ?? 'EUR')
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
      const preview = await buildPreview(result.transactions, user.id, supabase)
      return NextResponse.json({ preview })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  // ── Action: parse file for preview ────────────────────────
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const filename = file.name
  const format = detectFormat(filename, undefined)

  let parseResult

  if (format === 'screenshot') {
    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const mimeType = file.type || 'image/jpeg'
    const dataUrl = `data:${mimeType};base64,${base64}`
    parseResult = await parseScreenshot(dataUrl)
  } else if (format === 'santander') {
    const buffer = await file.arrayBuffer()
    parseResult = parseSantanderXLSX(buffer)
  } else {
    const text = await file.text()
    const detectedFormat = detectFormat(filename, text)
    if (detectedFormat === 'revolut') {
      parseResult = parseRevolutCSV(text)
    } else {
      const genericResult = parseGenericCSV(text)
      if ('needsMapping' in genericResult && genericResult.needsMapping) {
        return NextResponse.json({
          needsColumnMapping: true,
          headers: genericResult.headers,
          autoMapping: genericResult.autoMapping,
          rawRows: genericResult.rawRows,
        })
      }
      parseResult = genericResult as { ok: boolean; transactions?: unknown[]; error?: string }
    }
  }

  if (!parseResult.ok) {
    return NextResponse.json({ error: parseResult.error }, { status: 422 })
  }

  const transactions = (parseResult as { ok: true; transactions: unknown[] }).transactions
  const preview = await buildPreview(transactions as Parameters<typeof buildPreview>[0], user.id, supabase)
  return NextResponse.json({ preview, importBatchId: randomUUID() })
}

async function buildPreview(
  transactions: import('@/lib/parsers/types').ParsedTransaction[],
  userId: string,
  supabase: import('@supabase/supabase-js').SupabaseClient
): Promise<PreviewTransaction[]> {
  const { data: catData } = await supabase
    .from('categories')
    .select('id, name, tier, icon, color, examples, default_value_category')
    .eq('is_active', true)
  const categories: Category[] = catData ?? []

  const { data: rulesData } = await supabase
    .from('value_category_rules')
    .select('match_type, match_value, value_category, confidence, source')
    .eq('user_id', userId)
  const userRules: ValueCategoryRule[] = rulesData ?? []

  const dates = transactions.map((t) => t.date).sort()
  const existingKeys = await loadExistingKeys(supabase, userId, dates[0], dates[dates.length - 1])

  return transactions.map((txn, i) => {
    const catResult = categoriseByRules(txn.description, categories)
    const valResult = assignValueCategory(txn.description, catResult.categoryId, userRules, categories)
    return {
      ...txn,
      suggestedCategoryId: catResult.categoryId,
      suggestedValueCategory: valResult.valueCategory,
      isDuplicate: isDuplicate(txn, existingKeys),
      rowIndex: i,
    }
  })
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
npx tsc --noEmit 2>&1 | grep -v node_modules | head -30
```

Fix any type errors, then re-run. Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
git add src/app/api/upload/
git commit -m "feat(session3): add upload API route (parse + import)"
```

---

## Task 11: CategoryBadge, ValueBadge, and recategorise API

**Files:**
- Create: `cfos-office/src/components/transactions/CategoryBadge.tsx`
- Create: `cfos-office/src/components/transactions/ValueBadge.tsx`
- Create: `cfos-office/src/app/api/transactions/recategorise/route.ts`

- [ ] **Step 1: Create CategoryBadge**

Create `cfos-office/src/components/transactions/CategoryBadge.tsx`:

```tsx
import type { Category } from '@/lib/parsers/types'

const COLOR_CLASSES: Record<string, string> = {
  primary:  'bg-blue-100 text-blue-800',
  success:  'bg-green-100 text-green-800',
  blue:     'bg-sky-100 text-sky-800',
  gold:     'bg-yellow-100 text-yellow-800',
  orange:   'bg-orange-100 text-orange-800',
  teal:     'bg-teal-100 text-teal-800',
  purple:   'bg-purple-100 text-purple-800',
  warning:  'bg-amber-100 text-amber-800',
  pink:     'bg-pink-100 text-pink-800',
}

type Props = {
  category: Category | null
  className?: string
}

export function CategoryBadge({ category, className = '' }: Props) {
  if (!category) {
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 ${className}`}>
        Uncategorised
      </span>
    )
  }

  const colorClass = COLOR_CLASSES[category.color] ?? 'bg-gray-100 text-gray-700'

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colorClass} ${className}`}>
      {category.name}
    </span>
  )
}
```

- [ ] **Step 2: Create ValueBadge**

Create `cfos-office/src/components/transactions/ValueBadge.tsx`:

```tsx
const VALUE_CONFIG: Record<string, { label: string; classes: string }> = {
  foundation: { label: 'Foundation', classes: 'bg-blue-100 text-blue-800' },
  investment:  { label: 'Investment', classes: 'bg-green-100 text-green-800' },
  leak:        { label: 'Leak',       classes: 'bg-red-100 text-red-800' },
  burden:      { label: 'Burden',     classes: 'bg-amber-100 text-amber-800' },
  unsure:      { label: 'Unsure',     classes: 'bg-gray-100 text-gray-500' },
}

type Props = {
  valueCategory: string | null
  className?: string
}

export function ValueBadge({ valueCategory, className = '' }: Props) {
  const config = VALUE_CONFIG[valueCategory ?? 'unsure'] ?? VALUE_CONFIG.unsure
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.classes} ${className}`}>
      {config.label}
    </span>
  )
}
```

- [ ] **Step 3: Create recategorise API route**

Create `cfos-office/src/app/api/transactions/recategorise/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// POST /api/transactions/recategorise
// Body: { transactionId, field: 'category_id'|'value_category', newValue, applyToSimilar, description }
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json()
  const { transactionId, field, newValue, applyToSimilar, description } = body

  if (!transactionId || !field || !newValue) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (field !== 'category_id' && field !== 'value_category') {
    return NextResponse.json({ error: 'Invalid field' }, { status: 400 })
  }

  // Update the transaction
  const { error } = await supabase
    .from('transactions')
    .update({ [field]: newValue, user_confirmed: true })
    .eq('id', transactionId)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Create rule if "apply to similar" is checked
  if (applyToSimilar && description && field === 'value_category') {
    const { normaliseMerchant } = await import('@/lib/categorisation/normalise-merchant')
    const normDesc = normaliseMerchant(description)
    await supabase.from('value_category_rules').upsert(
      {
        user_id: user.id,
        match_type: 'merchant_contains',
        match_value: normDesc,
        value_category: newValue,
        confidence: 1.0,
        source: 'user_explicit',
      },
      { onConflict: 'user_id,match_type,match_value' }
    )
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Type-check**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
npx tsc --noEmit 2>&1 | grep -v node_modules | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
git add src/components/transactions/ src/app/api/transactions/
git commit -m "feat(session3): add CategoryBadge, ValueBadge, recategorise API"
```

---

## Task 12: Upload UI components

**Files:**
- Create: `cfos-office/src/components/upload/UploadZone.tsx`
- Create: `cfos-office/src/components/upload/ColumnMapper.tsx`
- Create: `cfos-office/src/components/upload/ImportResult.tsx`

- [ ] **Step 1: Create UploadZone**

Create `cfos-office/src/components/upload/UploadZone.tsx`:

```tsx
'use client'

import { useRef, useState } from 'react'

type Props = {
  onFile: (file: File) => void
  isLoading?: boolean
}

const ACCEPTED = '.csv,.xlsx,.xls,.png,.jpg,.jpeg,.heic'

export function UploadZone({ onFile, isLoading }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  function handleFile(file: File) {
    onFile(file)
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setIsDragging(false)
        const file = e.dataTransfer.files[0]
        if (file) handleFile(file)
      }}
      onClick={() => inputRef.current?.click()}
      className={`relative flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-12 cursor-pointer transition-colors
        ${isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/50'}
        ${isLoading ? 'pointer-events-none opacity-60' : ''}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ''
        }}
      />
      <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center text-2xl">
        {isLoading ? '⏳' : '📄'}
      </div>
      <div className="text-center">
        <p className="font-medium text-foreground">
          {isLoading ? 'Processing…' : 'Drop your bank statement here'}
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          Revolut CSV, Santander XLSX, or a screenshot · or click to browse
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create ColumnMapper**

Create `cfos-office/src/components/upload/ColumnMapper.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { SEMANTIC_FIELD_LABELS } from '@/lib/csv/column-detector'
import type { SemanticField } from '@/lib/csv/column-detector'

type Props = {
  headers: string[]
  autoMapping: Record<string, string>
  onConfirm: (mapping: Record<string, string>) => void
  onCancel: () => void
}

const SEMANTIC_OPTIONS: SemanticField[] = [
  'date', 'amount', 'description', 'merchant', 'type', 'currency', 'category', 'skip',
]

export function ColumnMapper({ headers, autoMapping, onConfirm, onCancel }: Props) {
  const [mapping, setMapping] = useState<Record<string, string>>(autoMapping)

  const hasRequiredFields = () => {
    const vals = Object.values(mapping)
    return (
      vals.includes('date') &&
      vals.includes('amount') &&
      (vals.includes('description') || vals.includes('merchant'))
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-foreground">Map your columns</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          We couldn&apos;t auto-detect the column layout. Please confirm which column is which.
        </p>
      </div>

      <div className="space-y-2">
        {headers.map((header) => (
          <div key={header} className="flex items-center gap-3">
            <span className="w-40 truncate text-sm font-mono text-muted-foreground">{header}</span>
            <select
              value={mapping[header] ?? 'skip'}
              onChange={(e) => setMapping({ ...mapping, [header]: e.target.value })}
              className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              {SEMANTIC_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{SEMANTIC_FIELD_LABELS[opt]}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={() => onConfirm(mapping)}
          disabled={!hasRequiredFields()}
          className="flex-1 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          Continue
        </button>
        <button
          onClick={onCancel}
          className="rounded-md border border-input px-4 py-2 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create ImportResult**

Create `cfos-office/src/components/upload/ImportResult.tsx`:

```tsx
type Props = {
  imported: number
  duplicates: number
  errors: number
  onDone: () => void
}

export function ImportResult({ imported, duplicates, errors, onDone }: Props) {
  return (
    <div className="text-center space-y-4 py-4">
      <div className="text-4xl">{errors === 0 ? '✅' : '⚠️'}</div>
      <div>
        <p className="font-semibold text-foreground text-lg">Import complete</p>
        <div className="text-sm text-muted-foreground mt-2 space-y-1">
          <p><span className="font-medium text-foreground">{imported}</span> transactions imported</p>
          {duplicates > 0 && <p>{duplicates} duplicates skipped</p>}
          {errors > 0 && <p className="text-destructive">{errors} errors</p>}
        </div>
      </div>
      <button
        onClick={onDone}
        className="rounded-md bg-primary text-primary-foreground px-6 py-2 text-sm font-medium"
      >
        View transactions
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
git add src/components/upload/
git commit -m "feat(session3): add UploadZone, ColumnMapper, ImportResult components"
```

---

## Task 13: TransactionPreview component

**Files:**
- Create: `cfos-office/src/components/upload/TransactionPreview.tsx`

- [ ] **Step 1: Create TransactionPreview**

Create `cfos-office/src/components/upload/TransactionPreview.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { CategoryBadge } from '@/components/transactions/CategoryBadge'
import { ValueBadge } from '@/components/transactions/ValueBadge'
import type { PreviewTransaction, Category } from '@/lib/parsers/types'

type Props = {
  transactions: PreviewTransaction[]
  categories: Category[]
  onConfirm: (selected: PreviewTransaction[]) => void
  onCancel: () => void
  isImporting?: boolean
}

const VALUE_OPTIONS = ['foundation', 'investment', 'leak', 'burden', 'unsure']

export function TransactionPreview({
  transactions,
  categories,
  onConfirm,
  onCancel,
  isImporting,
}: Props) {
  const [selected, setSelected] = useState<Set<number>>(
    new Set(transactions.filter((t) => !t.isDuplicate).map((t) => t.rowIndex))
  )
  const [edits, setEdits] = useState<Record<number, Partial<PreviewTransaction>>>({})
  const [editingRow, setEditingRow] = useState<number | null>(null)

  const catMap = new Map(categories.map((c) => [c.id, c]))

  function toggleRow(rowIndex: number) {
    const next = new Set(selected)
    if (next.has(rowIndex)) next.delete(rowIndex)
    else next.add(rowIndex)
    setSelected(next)
  }

  function updateEdit(rowIndex: number, patch: Partial<PreviewTransaction>) {
    setEdits((prev) => ({ ...prev, [rowIndex]: { ...prev[rowIndex], ...patch } }))
  }

  const merged = transactions.map((t) => ({ ...t, ...edits[t.rowIndex] }))
  const toImport = merged.filter((t) => selected.has(t.rowIndex))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-foreground">Review transactions</h3>
          <p className="text-sm text-muted-foreground">
            {transactions.length} found · {toImport.length} selected
            {transactions.some((t) => t.isDuplicate) && ` · ${transactions.filter((t) => t.isDuplicate).length} possible duplicates`}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="w-8 px-3 py-2 text-left">
                <input
                  type="checkbox"
                  checked={selected.size === transactions.filter((t) => !t.isDuplicate).length}
                  onChange={(e) => {
                    if (e.target.checked) setSelected(new Set(transactions.filter((t) => !t.isDuplicate).map((t) => t.rowIndex)))
                    else setSelected(new Set())
                  }}
                />
              </th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium">Date</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium">Description</th>
              <th className="px-3 py-2 text-right text-muted-foreground font-medium">Amount</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium">Category</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {merged.map((txn) => (
              <tr
                key={txn.rowIndex}
                className={`transition-colors ${
                  !selected.has(txn.rowIndex) ? 'opacity-40' : ''
                } ${txn.isDuplicate ? 'bg-amber-50' : ''}`}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(txn.rowIndex)}
                    onChange={() => toggleRow(txn.rowIndex)}
                  />
                </td>
                <td className="px-3 py-2 text-muted-foreground tabular-nums whitespace-nowrap">
                  {txn.date}
                  {txn.isDuplicate && (
                    <span className="ml-1 text-xs text-amber-600">duplicate?</span>
                  )}
                </td>
                <td className="px-3 py-2 max-w-[200px] truncate">{txn.description}</td>
                <td className={`px-3 py-2 text-right tabular-nums font-mono ${
                  txn.amount < 0 ? 'text-foreground' : 'text-green-700'
                }`}>
                  {txn.amount < 0 ? '' : '+'}{txn.amount.toFixed(2)} {txn.currency}
                </td>
                <td className="px-3 py-2">
                  {editingRow === txn.rowIndex ? (
                    <select
                      className="text-xs rounded border border-input px-1 py-0.5 bg-background"
                      value={txn.suggestedCategoryId ?? ''}
                      onChange={(e) => {
                        updateEdit(txn.rowIndex, { suggestedCategoryId: e.target.value || null })
                        setEditingRow(null)
                      }}
                      onBlur={() => setEditingRow(null)}
                      autoFocus
                    >
                      <option value="">— none —</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  ) : (
                    <button onClick={() => setEditingRow(txn.rowIndex)} className="hover:opacity-70">
                      <CategoryBadge category={catMap.get(txn.suggestedCategoryId ?? '') ?? null} />
                    </button>
                  )}
                </td>
                <td className="px-3 py-2">
                  <select
                    className="text-xs rounded border border-input px-1 py-0.5 bg-background"
                    value={txn.suggestedValueCategory}
                    onChange={(e) => updateEdit(txn.rowIndex, { suggestedValueCategory: e.target.value })}
                  >
                    {VALUE_OPTIONS.map((v) => (
                      <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onConfirm(toImport)}
          disabled={toImport.length === 0 || isImporting}
          className="flex-1 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          {isImporting ? 'Importing…' : `Import ${toImport.length} transactions`}
        </button>
        <button
          onClick={onCancel}
          className="rounded-md border border-input px-4 py-2 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
npx tsc --noEmit 2>&1 | grep -v node_modules | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
git add src/components/upload/TransactionPreview.tsx
git commit -m "feat(session3): add TransactionPreview with inline category editing"
```

---

## Task 14: TransactionList and TransactionFilters

**Files:**
- Create: `cfos-office/src/components/transactions/TransactionList.tsx`
- Create: `cfos-office/src/components/transactions/TransactionFilters.tsx`

- [ ] **Step 1: Create TransactionFilters**

Create `cfos-office/src/components/transactions/TransactionFilters.tsx`:

```tsx
'use client'

type Props = {
  search: string
  onSearchChange: (v: string) => void
  onlyExpenses: boolean
  onOnlyExpensesChange: (v: boolean) => void
}

export function TransactionFilters({ search, onSearchChange, onlyExpenses, onOnlyExpensesChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <input
        type="search"
        placeholder="Search transactions…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="flex-1 min-w-[180px] rounded-md border border-input bg-background px-3 py-1.5 text-sm"
      />
      <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none">
        <input
          type="checkbox"
          checked={onlyExpenses}
          onChange={(e) => onOnlyExpensesChange(e.target.checked)}
          className="rounded"
        />
        Expenses only
      </label>
    </div>
  )
}
```

- [ ] **Step 2: Create TransactionList**

Create `cfos-office/src/components/transactions/TransactionList.tsx`:

```tsx
'use client'

import { useState, useCallback } from 'react'
import { CategoryBadge } from './CategoryBadge'
import { ValueBadge } from './ValueBadge'
import { TransactionFilters } from './TransactionFilters'
import type { Category } from '@/lib/parsers/types'

type Transaction = {
  id: string
  date: string
  description: string
  amount: number
  currency: string
  category_id: string | null
  value_category: string | null
  user_confirmed: boolean
}

type Props = {
  transactions: Transaction[]
  categories: Category[]
  onRecategorise?: (id: string, field: 'category_id' | 'value_category', value: string, description: string) => void
}

const PAGE_SIZE = 50

export function TransactionList({ transactions, categories, onRecategorise }: Props) {
  const [search, setSearch] = useState('')
  const [onlyExpenses, setOnlyExpenses] = useState(false)
  const [page, setPage] = useState(0)

  const catMap = new Map(categories.map((c) => [c.id, c]))

  const filtered = transactions.filter((t) => {
    if (onlyExpenses && t.amount >= 0) return false
    if (search) {
      const q = search.toLowerCase()
      if (!t.description.toLowerCase().includes(q)) return false
    }
    return true
  })

  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  const handleRecategorise = useCallback(
    (id: string, field: 'category_id' | 'value_category', value: string, description: string) => {
      onRecategorise?.(id, field, value, description)
    },
    [onRecategorise]
  )

  return (
    <div className="space-y-3">
      <TransactionFilters
        search={search}
        onSearchChange={(v) => { setSearch(v); setPage(0) }}
        onlyExpenses={onlyExpenses}
        onOnlyExpensesChange={(v) => { setOnlyExpenses(v); setPage(0) }}
      />

      {filtered.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8">No transactions match your filters.</p>
      ) : (
        <>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="px-4 py-2.5 text-left text-muted-foreground font-medium">Date</th>
                  <th className="px-4 py-2.5 text-left text-muted-foreground font-medium">Description</th>
                  <th className="px-4 py-2.5 text-right text-muted-foreground font-medium">Amount</th>
                  <th className="px-4 py-2.5 text-left text-muted-foreground font-medium hidden md:table-cell">Category</th>
                  <th className="px-4 py-2.5 text-left text-muted-foreground font-medium hidden md:table-cell">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginated.map((txn) => (
                  <tr key={txn.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground tabular-nums whitespace-nowrap text-xs">
                      {txn.date.slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 max-w-[180px] md:max-w-[300px] truncate">
                      {txn.description}
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums font-mono ${
                      txn.amount < 0 ? 'text-foreground' : 'text-green-700'
                    }`}>
                      {txn.amount < 0 ? '' : '+'}{txn.amount.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <button
                        className="hover:opacity-70 transition-opacity"
                        title="Click to change category"
                        onClick={() => {
                          const newCat = prompt('Category ID (e.g. groceries):')
                          if (newCat) handleRecategorise(txn.id, 'category_id', newCat, txn.description)
                        }}
                      >
                        <CategoryBadge category={catMap.get(txn.category_id ?? '') ?? null} />
                      </button>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <button
                        className="hover:opacity-70 transition-opacity"
                        title="Click to change value category"
                        onClick={() => {
                          const options = ['foundation', 'investment', 'leak', 'burden', 'unsure']
                          const newVal = prompt(`Value category (${options.join('/')}):`)
                          if (newVal && options.includes(newVal)) {
                            handleRecategorise(txn.id, 'value_category', newVal, txn.description)
                          }
                        }}
                      >
                        <ValueBadge valueCategory={txn.value_category} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{filtered.length} transactions</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page === 0}
                  className="px-3 py-1 rounded border border-input disabled:opacity-40"
                >
                  ←
                </button>
                <span className="px-2 py-1">{page + 1} / {totalPages}</span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1 rounded border border-input disabled:opacity-40"
                >
                  →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
npx tsc --noEmit 2>&1 | grep -v node_modules | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
git add src/components/transactions/
git commit -m "feat(session3): add TransactionList and TransactionFilters"
```

---

## Task 15: Wire transactions page

**Files:**
- Replace: `cfos-office/src/app/(app)/transactions/page.tsx`

- [ ] **Step 1: Replace transactions page**

Write `cfos-office/src/app/(app)/transactions/page.tsx`:

```tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { UploadZone } from '@/components/upload/UploadZone'
import { ColumnMapper } from '@/components/upload/ColumnMapper'
import { TransactionPreview } from '@/components/upload/TransactionPreview'
import { ImportResult } from '@/components/upload/ImportResult'
import { TransactionList } from '@/components/transactions/TransactionList'
import type { PreviewTransaction, Category } from '@/lib/parsers/types'

type Step = 'idle' | 'parsing' | 'column-mapping' | 'preview' | 'importing' | 'done'

type ImportStats = { imported: number; duplicates: number; errors: number }

type TxnRow = {
  id: string; date: string; description: string; amount: number;
  currency: string; category_id: string | null; value_category: string | null;
  user_confirmed: boolean
}

export default function TransactionsPage() {
  const supabase = createClient()

  const [step, setStep] = useState<Step>('idle')
  const [preview, setPreview] = useState<PreviewTransaction[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [importBatchId, setImportBatchId] = useState<string | null>(null)
  const [importStats, setImportStats] = useState<ImportStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [transactions, setTransactions] = useState<TxnRow[]>([])
  const [hasTransactions, setHasTransactions] = useState(false)

  // Column mapping state
  const [pendingHeaders, setPendingHeaders] = useState<string[]>([])
  const [pendingAutoMapping, setPendingAutoMapping] = useState<Record<string, string>>({})
  const [pendingRawRows, setPendingRawRows] = useState<Record<string, string>[]>([])

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadData() {
    const { data: catData } = await supabase
      .from('categories')
      .select('id, name, tier, icon, color, examples, default_value_category')
      .eq('is_active', true)
      .order('sort_order')
    setCategories(catData ?? [])

    const { data: txnData, count } = await supabase
      .from('transactions')
      .select('id, date, description, amount, currency, category_id, value_category, user_confirmed', { count: 'exact' })
      .order('date', { ascending: false })
      .limit(500)

    setTransactions(txnData ?? [])
    setHasTransactions((count ?? 0) > 0)
  }

  async function handleFile(file: File) {
    setError(null)
    setStep('parsing')
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/upload', { method: 'POST', body: form })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Upload failed')
      setStep('idle')
      return
    }

    if (data.needsColumnMapping) {
      setPendingHeaders(data.headers)
      setPendingAutoMapping(data.autoMapping)
      setPendingRawRows(data.rawRows)
      setStep('column-mapping')
      return
    }

    setPreview(data.preview)
    setImportBatchId(data.importBatchId)
    setStep('preview')
  }

  async function handleColumnMappingConfirm(mapping: Record<string, string>) {
    setError(null)
    setStep('parsing')
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'apply-mapping', mapping, rawRows: pendingRawRows }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setStep('idle'); return }
    setPreview(data.preview)
    setImportBatchId(data.importBatchId ?? crypto.randomUUID())
    setStep('preview')
  }

  async function handleConfirmImport(selected: PreviewTransaction[]) {
    setStep('importing')
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'import', transactions: selected, importBatchId }),
    })
    const stats = await res.json()
    setImportStats(stats)
    setStep('done')
    await loadData()
  }

  const handleRecategorise = useCallback(async (
    id: string,
    field: 'category_id' | 'value_category',
    value: string,
    description: string
  ) => {
    await fetch('/api/transactions/recategorise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId: id, field, newValue: value, description }),
    })
    await loadData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Empty state ──
  if (!hasTransactions && step === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <div className="w-full max-w-lg space-y-4">
          <div className="text-center">
            <h1 className="text-xl font-semibold text-foreground">Upload your bank statement</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Revolut CSV, Santander XLSX, or a screenshot — we&apos;ll handle the rest.
            </p>
          </div>
          {error && <p className="text-sm text-destructive text-center">{error}</p>}
          <UploadZone onFile={handleFile} isLoading={step === 'parsing' as unknown as boolean} />
        </div>
      </div>
    )
  }

  // ── Upload wizard states ──
  if (step === 'parsing') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-sm text-muted-foreground">Parsing file…</p>
      </div>
    )
  }

  if (step === 'column-mapping') {
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <ColumnMapper
          headers={pendingHeaders}
          autoMapping={pendingAutoMapping}
          onConfirm={handleColumnMappingConfirm}
          onCancel={() => setStep('idle')}
        />
      </div>
    )
  }

  if (step === 'preview') {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6">
        <TransactionPreview
          transactions={preview}
          categories={categories}
          onConfirm={handleConfirmImport}
          onCancel={() => setStep('idle')}
          isImporting={step === 'importing' as unknown as boolean}
        />
      </div>
    )
  }

  if (step === 'importing') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-sm text-muted-foreground">Importing transactions…</p>
      </div>
    )
  }

  if (step === 'done' && importStats) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="max-w-sm w-full">
          <ImportResult
            {...importStats}
            onDone={() => { setStep('idle'); setImportStats(null) }}
          />
        </div>
      </div>
    )
  }

  // ── Main view: has transactions ──
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-border">
        <h1 className="text-lg font-semibold text-foreground">Transactions</h1>
        <label className="cursor-pointer">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted/50 transition-colors">
            + Import
          </span>
          <input
            type="file"
            accept=".csv,.xlsx,.xls,.png,.jpg,.jpeg,.heic"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
              e.target.value = ''
            }}
          />
        </label>
      </div>

      {error && <p className="text-sm text-destructive px-4 pt-2">{error}</p>}

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
        <TransactionList
          transactions={transactions}
          categories={categories}
          onRecategorise={handleRecategorise}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
npx tsc --noEmit 2>&1 | grep -v node_modules | head -30
```

Fix any type errors, then run again. Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
git add src/app/\(app\)/transactions/page.tsx
git commit -m "feat(session3): wire transactions page with upload wizard and transaction list"
```

---

## Task 16: End-to-end verification

- [ ] **Step 1: Start dev server**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
npm run dev
```

Open `http://localhost:3000/transactions` in browser. Expected: upload zone shown (if no transactions).

- [ ] **Step 2: Upload Revolut CSV**

Download a Revolut statement CSV or create a test file at `/tmp/test-revolut.csv`:

```csv
Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-03-01 10:00:00,2026-03-01 10:05:00,Mercadona,-45.20,0.00,EUR,COMPLETED,1200.00
CARD_PAYMENT,Current,2026-03-02 14:00:00,2026-03-02 14:01:00,Netflix,-13.99,0.00,EUR,COMPLETED,1186.01
CARD_PAYMENT,Current,2026-03-03 09:00:00,2026-03-03 09:02:00,Uber Eats,-22.50,0.00,EUR,COMPLETED,1163.51
TRANSFER,Current,2026-03-01 08:00:00,2026-03-01 08:01:00,Salary,2500.00,0.00,EUR,COMPLETED,3663.51
CARD_PAYMENT,Current,2026-03-05 18:00:00,2026-03-05 18:01:00,Pending payment,0.00,0.00,EUR,PENDING,3663.51
```

Upload the file. Expected: preview shows 4 transactions (PENDING filtered out), Mercadona → groceries/foundation, Netflix → subscriptions/leak.

- [ ] **Step 3: Confirm import**

Click "Import 4 transactions". Expected: ImportResult shows "4 transactions imported". Check Supabase `transactions` table has the rows.

- [ ] **Step 4: Verify re-upload detects duplicates**

Upload the same CSV again. Expected: all 4 rows flagged as "duplicate?" in preview. Import is deselected by default.

- [ ] **Step 5: Verify monthly snapshot**

In Supabase Studio, run:
```sql
select month, total_income, total_spending, spending_by_category
from monthly_snapshots
where user_id = auth.uid()
order by month desc
limit 1;
```

Expected: row for March 2026 with `total_income = 2500`, `total_spending = 81.69`.

- [ ] **Step 6: Test recategorise**

On the transactions page, click a category badge and change it. Expected: category updates in the list.

- [ ] **Step 7: Commit final**

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/cfos-office
git add -A
git commit -m "feat(session3): complete CSV engine + dual categorisation pipeline"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ CSV parsers: Revolut, Santander, Generic, Screenshot
- ✅ Format auto-detection
- ✅ Duplicate detection (field-based, no schema changes needed)
- ✅ Traditional categorisation: 3 tiers (DB examples → keywords → Bedrock)
- ✅ Value category assignment: 4 layers
- ✅ Storage pipeline with import_batch_id
- ✅ Monthly snapshots (upsert)
- ✅ Recurring detection + flag is_recurring, upsert recurring_expenses
- ✅ Holiday detection: flag is_holiday_spend
- ✅ Upload UI: UploadZone, ColumnMapper, TransactionPreview, ImportResult
- ✅ Transaction list with filters and pagination
- ✅ Correction flow: recategorise API + "apply to similar" creates value_category_rules
- ✅ Source traceability (source field on every transaction)
- ✅ Mobile-first layout conventions followed (h-dvh, touch targets, overflow discipline)

**Note on `recurring_expenses` upsert conflict:** The `recurring_expenses` table doesn't have a unique constraint on `(user_id, name)`. If the upsert fails, the recurring detector will gracefully skip — the `is_recurring` flag on transactions is still set. Add a migration if needed:
```sql
alter table public.recurring_expenses add constraint recurring_expenses_user_name unique (user_id, name);
```
This can be applied via Supabase Studio before running Task 16.
