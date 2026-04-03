# Session 3: CSV Engine + Dual Categorisation — Design Spec

## Context

Session 3 builds the data ingestion backbone for The CFO's Office. Everything downstream (dashboard, Gap analysis, monthly reviews, bill optimisation) depends on getting transaction data into the system with dual categorisation (traditional category + value category).

Sessions 1-2 delivered: auth, layout, Value Map, chat on Bedrock with streaming. The database schema is fully migrated (001-006) with the `categories` table seeded (15 categories with `examples[]` and `default_value_category`), `transactions` table with `category_id` + `value_category` columns, and supporting tables (`value_category_rules`, `monthly_snapshots`, `recurring_expenses`, `trips`).

**Key decision**: There is substantial reference code in `/src/` from the MVP. We will port the proven foundations (column detection, CSV transform, merchant normalisation, deduplication hashing, keyword rules) and adapt them to the new schema. UI components and AI categorisation will be built fresh.

---

## Data Flow

```
CSV file ─────→ Format detect ─→ Parse ─→ [ParsedTransaction[]]
XLSX file ────→ XLSX parse ────→ Parse ─→ [ParsedTransaction[]]  ──→ Categorise ──→ Dedupe ──→ Store ──→ Post-import
Screenshot ───→ Bedrock vision ────────→ [ParsedTransaction[]]      (trad + val)   (hash)    (insert)  (snapshots,
                                                                                                         recurring,
                                                                                                         holiday)
```

### Normalised Output Type

```typescript
type ParsedTransaction = {
  date: string;            // ISO YYYY-MM-DD
  description: string;     // cleaned, trimmed
  amount: number;          // SIGNED: negative = expense, positive = income
  currency: string;        // ISO 4217: 'EUR', 'GBP', etc.
  source: 'csv_revolut' | 'csv_santander' | 'csv_generic' | 'screenshot';
  raw_description: string; // original text before cleaning
};
```

**Amount convention**: Signed amounts throughout. Negative = expense, positive = income. This matches the DB schema (`amount NUMERIC` with no type column) and simplifies aggregation (`SUM(amount)` gives net).

---

## Component Architecture

### 1. Format Detection & Parsing

**Port from reference**: `column-detector.ts`, `transform.ts` (adapted for signed amounts), `hash.ts`

**`lib/parsers/index.ts`** — Format auto-detection:
- Read file extension + first 5 rows of content
- If `.xlsx` → Santander parser
- If headers contain Revolut-specific columns (Type, Product, Started Date, Completed Date, Description, Amount, Fee, Currency, State, Balance) → Revolut parser
- If image file (`.png`, `.jpg`, `.jpeg`, `.heic`) → Screenshot parser
- Otherwise → Generic parser with column mapping UI

**`lib/parsers/revolut.ts`** — Revolut CSV:
- Use PapaParse (already a dependency) to parse CSV
- Map known columns: use "Completed Date" as date, "Description" for description, "Amount" (already signed), "Currency" per row
- Filter: only rows where `State === "COMPLETED"`
- Source: `'csv_revolut'`

**`lib/parsers/santander.ts`** — Santander XLSX:
- Install `xlsx` package for .xlsx reading
- Handle Spanish format: DD/MM/YYYY dates, comma decimals (1.234,56)
- Handle encoding for Spanish characters
- Source: `'csv_santander'`

**`lib/parsers/generic.ts`** — Generic CSV fallback:
- Use ported `column-detector.ts` for auto-detection of date/amount/description/currency columns
- If `isMappingHighConfidence()` → skip column mapping step
- Otherwise → show `ColumnMapper` component for manual assignment
- Use ported `transform.ts` (adapted) to convert rows
- Source: `'csv_generic'`

**`lib/parsers/screenshot.ts`** — Screenshot extraction:
- Upload image to Supabase Storage (or use base64)
- Send to Bedrock via `analysisModel` with vision capabilities
- Extraction prompt instructs Claude to return JSON array of transactions
- Handle Spanish bank formats (comma decimals, DD/MM dates)
- Source: `'screenshot'`
- Reference: existing `/api/value-map/extract/route.ts` pattern for Bedrock vision calls

### 2. Traditional Categorisation

**`lib/categorisation/rules-engine.ts`** — Three-tier rules:

**Tier 1 — DB examples match** (confidence: 1.0):
```typescript
// Load categories with examples[] from Supabase (cache for session)
// For each transaction, check if normalised description contains any example string
// Longest match wins (same pattern as reference code)
```

**Tier 2 — Keyword heuristics** (confidence: 0.8):
Port the 200+ keyword rules from reference `categorise-transaction.ts`, but mapped to DB category slugs:
- `'Housing'` → `'housing'`
- `'Groceries'` → `'groceries'`
- `'Dining out'` → `'eat_drinking_out'`
- `'Healthcare'` → `'health'`
- `'Utilities'` → `'utilities_bills'`
- etc.

Also apply `normaliseMerchant()` (ported) before matching.

**Tier 3 — Bedrock LLM batch** (confidence: 0.4-0.8):
```typescript
// Batch unmatched transactions (up to 50 per call)
// Use generateText() with analysisModel
// Prompt includes all category slugs with descriptions
// Returns JSON array: [{ index, category_id, confidence }]
// Never assign confidence >= 1.0 for LLM results
```

**`lib/categorisation/normalise-merchant.ts`** — Ported as-is from reference:
- Strips: CARD PAYMENT TO, DIRECT DEBIT TO, POS, DD, STO, etc.
- Strips: LTD, GMBH, AG, LLC, S.L., S.A., etc.
- Strips reference numbers
- Unicode-safe

### 3. Value Category Assignment

**`lib/categorisation/value-categoriser.ts`** — Layered priority:

```
Priority 1: User description rules (value_category_rules WHERE match_type = 'merchant_contains')
Priority 2: User category rules  (value_category_rules WHERE match_type = 'category_id')
Priority 3: Category defaults     (categories.default_value_category)
Priority 4: Fallback              → 'unsure', confidence: 0
```

Each layer returns `{ valueCategory, confidence, source }`. First match wins.

User rules come from two sources:
- Value Map seed (source: `'value_map'`) — created when anonymous session links to account
- User corrections (source: `'user_explicit'`) — created via "apply to similar" in the UI

### 4. Storage Pipeline

**`lib/upload/pipeline.ts`** — Orchestrates the full flow:

```typescript
async function processImport(
  parsed: ParsedTransaction[],
  userId: string,
  accountId: string | null,
  importBatchId: string
): Promise<{ imported: number; duplicates: number; errors: number }>
```

Steps:
1. Load categories (system-wide, cached)
2. Load user's value_category_rules
3. For each transaction:
   a. Generate hash via `generateExternalId()` (ported)
   b. Check for duplicates (same user + hash)
   c. Run traditional categorisation (tiers 1-3)
   d. Run value categorisation (layers 1-4)
   e. Insert to `transactions` table
4. Batch LLM categorisation for unmatched (tier 3)
5. Update transactions with LLM results
6. Return stats

**Duplicate detection** (`lib/upload/duplicate-detector.ts`):
- No `external_id` column exists in the schema. Detect duplicates by matching: `user_id` + `date` + `amount` + normalised `description`
- Query existing transactions for the date range of the import batch
- Compare each incoming transaction against existing ones
- Flag duplicates in preview UI (highlighted row, "possible duplicate" badge)
- Skip duplicates by default during import, but allow user to override per-row

### 5. Post-Import Analytics

**`lib/analytics/monthly-snapshot.ts`**:
- After import, identify distinct months from imported transactions
- For each month, compute via SQL:
  - `total_income`: SUM(amount) WHERE amount > 0
  - `total_spending`: ABS(SUM(amount)) WHERE amount < 0
  - `spending_by_category`: GROUP BY category_id
  - `spending_by_value_category`: GROUP BY value_category
  - `transaction_count`, `avg_transaction_size`, `largest_transaction`
  - `vs_previous_month_pct`: compare with prior month's `total_spending`
- UPSERT on `(user_id, month)` conflict

**`lib/analytics/recurring-detector.ts`**:
- After import, find normalised descriptions appearing in 2+ distinct months
- Same description within ±5 days of the same day-of-month
- Flag matching transactions: `is_recurring = true`
- Upsert to `recurring_expenses`: name, amount, frequency, billing_day
- Don't assume monthly — check interval pattern for bi-monthly/quarterly

**`lib/analytics/holiday-detector.ts`**:
- Compare transaction currency against user's `primary_currency` (from user_profiles)
- Group foreign-currency transactions within a date window (±2 days gap)
- Flag cluster members: `is_holiday_spend = true`
- Don't create trips — just flag

### 6. Upload UI

Located on `/transactions` page.

**Empty state**: Full-screen drag-and-drop zone. "Upload your bank statement to get started." Accepts CSV, XLSX, images.

**Has transactions**: Compact upload button in page header. Transaction list below with filters (date, category, value category, search).

**Upload wizard** (4 steps):
1. **File drop** — drag-and-drop + file picker. Format auto-detected.
2. **Column mapping** — only shown if auto-detect isn't high-confidence. User maps columns to date/amount/description/currency.
3. **Preview** — table showing: date, description, amount, suggested category (with icon/color from categories table), suggested value category. Duplicates highlighted. User can edit categories per row.
4. **Result** — summary: X imported, Y duplicates skipped, Z errors.

**Components:**
- `components/upload/UploadZone.tsx` — drag-and-drop + file picker
- `components/upload/ColumnMapper.tsx` — column mapping UI (for generic CSV)
- `components/upload/TransactionPreview.tsx` — preview table with inline editing
- `components/upload/ImportResult.tsx` — post-import summary

**Transaction list** (shown after first import):
- `components/transactions/TransactionList.tsx` — paginated table
- `components/transactions/TransactionFilters.tsx` — date/category/value/search
- `components/transactions/CategoryBadge.tsx` — traditional category pill
- `components/transactions/ValueBadge.tsx` — value category pill

### 7. Correction Flow

**Pre-import (in preview)**: Click category or value badge to change. Shows category picker (uses categories from DB). Changes apply before insertion.

**Post-import**: Click any transaction row to edit category/value. "Apply to all similar" checkbox:
- For value category: creates `value_category_rules` entry with `match_type = 'merchant_contains'`, `source = 'user_explicit'`, `confidence = 1.0`
- Sets `user_confirmed = true` on the corrected transaction

### 8. API Route

**`app/api/upload/route.ts`** — POST handler:
- Receives FormData with file
- Routes to appropriate parser based on format detection
- Returns parsed transactions as JSON for preview
- On confirm (second POST with `action: 'import'`), runs pipeline
- Returns import stats

---

## Files to Create/Modify

### New files in `cfos-office/src/`:

```
lib/parsers/index.ts                    — Format auto-detection
lib/parsers/revolut.ts                  — Revolut CSV parser
lib/parsers/santander.ts                — Santander XLSX parser
lib/parsers/generic.ts                  — Generic CSV with column mapping
lib/parsers/screenshot.ts               — Bedrock vision extraction
lib/parsers/types.ts                    — ParsedTransaction type + shared types

lib/categorisation/rules-engine.ts      — Three-tier traditional categorisation
lib/categorisation/llm-categoriser.ts   — Bedrock batch fallback
lib/categorisation/value-categoriser.ts — Value category assignment
lib/categorisation/normalise-merchant.ts — REPLACE stub with ported reference
lib/categorisation/categorise-transaction.ts — REPLACE stub (or remove, replaced by rules-engine)

lib/csv/column-detector.ts             — REPLACE stub with ported reference
lib/csv/transform.ts                   — REPLACE stub with ported+adapted reference
lib/csv/hash.ts                        — Port from reference (new file)

lib/upload/pipeline.ts                 — Unified categorise-and-store pipeline
lib/upload/duplicate-detector.ts       — Hash-based deduplication

lib/analytics/monthly-snapshot.ts      — Compute/upsert monthly snapshots
lib/analytics/recurring-detector.ts    — Detect recurring charges
lib/analytics/holiday-detector.ts      — Cluster foreign currency transactions

app/api/upload/route.ts                — POST handler for file upload + import

components/upload/UploadZone.tsx        — Drag-and-drop UI
components/upload/ColumnMapper.tsx      — Generic CSV column mapping
components/upload/TransactionPreview.tsx — Review table with edit
components/upload/ImportResult.tsx      — Post-import summary

components/transactions/TransactionList.tsx     — Paginated transaction table
components/transactions/TransactionFilters.tsx  — Filter controls
components/transactions/CategoryBadge.tsx       — Traditional category pill
components/transactions/ValueBadge.tsx          — Value category pill
```

### Modified files:

```
app/(app)/transactions/page.tsx         — Replace placeholder with upload + list
package.json                            — Add xlsx dependency
```

### Dependencies to add:

```
xlsx — for Santander XLSX parsing
```

(PapaParse already installed for CSV parsing)

---

## Verification Plan

After implementation, verify end-to-end:

1. **Upload Revolut CSV** → auto-detected → preview shows transactions with categories → confirm → stored in DB
2. **Upload screenshot** → Bedrock extracts transactions → preview → confirm → same pipeline
3. **Upload unknown CSV** → column mapper shown → user maps columns → preview → confirm
4. **Duplicate detection** — re-upload same CSV → duplicates flagged in preview, not imported
5. **Traditional categories** — Mercadona → `groceries`, Netflix → `subscriptions`, rent → `housing`
6. **Value categories** — groceries → `foundation` (category default), subscriptions → `leak` (default). If Value Map completed, user rules override.
7. **Monthly snapshot** — check `monthly_snapshots` table has correct totals
8. **Recurring detection** — Netflix/gym appearing monthly flagged as `is_recurring`
9. **Corrections** — change a category in preview, "apply to similar" creates a rule
10. **Source traceability** — each transaction has correct `source` field

Run dev server and test with real Revolut CSV data + a phone screenshot.
