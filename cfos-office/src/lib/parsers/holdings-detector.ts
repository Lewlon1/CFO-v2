// Column header detection for holdings / portfolio CSV exports.
//
// This runs BEFORE the transaction format detection in the upload route.
// If it returns a non-null mapping, the file is treated as a holdings CSV
// (Vanguard, Hargreaves Lansdown, Trading 212, Interactive Brokers, etc.)
// and passed to `parseHoldingsCSV`. Otherwise the file falls through to
// the existing transaction parsers.
//
// Mirrors the pattern in src/lib/csv/column-detector.ts but with a
// holdings-specific semantic-field set.

export type HoldingsSemanticField =
  | 'ticker'
  | 'name'
  | 'quantity'
  | 'value'
  | 'cost_basis'
  | 'gain_loss'
  | 'currency'
  | 'asset_type'
  | 'price'
  | 'skip'

const HOLDINGS_FIELD_PATTERNS: Record<Exclude<HoldingsSemanticField, 'skip'>, RegExp[]> = {
  ticker: [
    /^ticker/i,
    /^symbol/i,
    /^isin/i,
    /^sedol/i,
    /^epic/i,
    /^code$/i,
  ],
  name: [
    /^(fund|stock|holding|security|investment).?name/i,
    /^instrument/i,
    /^financial.?instrument/i,
    /^description/i,
    /^name$/i,
    /^fund$/i,
    /^security$/i,
    /^stock$/i,
  ],
  quantity: [
    /^units/i,
    /^quantity/i,
    /^shares/i,
    /^holding$/i,
    /^number.?of/i,
    /^qty/i,
    /^no\.?\s*of/i,
  ],
  value: [
    /^(market.?)?value/i,
    /^current.?value/i,
    /^total.?value/i,
    /^worth/i,
    /^val$/i,
  ],
  cost_basis: [
    /^cost$/i,
    /^book.?cost/i,
    /^cost.?basis/i,
    /^average.?cost/i,
    /^invested/i,
    /^amount.?invested/i,
    /^purchase.?price/i,
  ],
  gain_loss: [
    /^gain/i,
    /^loss/i,
    /^profit/i,
    /^return/i,
    /^p.?l$/i,
    /^change/i,
    /^total.?result/i,
  ],
  currency: [
    /^currency/i,
    /^ccy$/i,
  ],
  asset_type: [
    /^(asset.?)?type/i,
    /^class/i,
    /^category/i,
    /^sector/i,
  ],
  price: [
    /^price/i,
    /^unit.?price/i,
    /^market.?price/i,
    /^nav$/i,
  ],
}

/**
 * Detect whether a CSV's headers look like a holdings report.
 * Returns the header→field mapping if it does, or `null` if it doesn't
 * — in which case the caller should fall through to transaction parsing.
 *
 * Minimum requirement: headers must contain (name OR ticker) AND (value OR quantity).
 * This is deliberately strict so transaction CSVs (which have `amount` + `date`)
 * don't accidentally match.
 */
export function detectHoldingsMapping(
  headers: string[]
): Record<string, HoldingsSemanticField> | null {
  const result: Record<string, HoldingsSemanticField> = {}
  const usedFields = new Set<HoldingsSemanticField>()

  for (const header of headers) {
    let detected: HoldingsSemanticField = 'skip'
    const trimmed = header.trim()

    for (const [field, patterns] of Object.entries(HOLDINGS_FIELD_PATTERNS) as [
      Exclude<HoldingsSemanticField, 'skip'>,
      RegExp[]
    ][]) {
      if (usedFields.has(field)) continue
      if (patterns.some((p) => p.test(trimmed))) {
        detected = field
        usedFields.add(field)
        break
      }
    }
    result[header] = detected
  }

  const fields = Object.values(result)
  const hasIdentifier = fields.includes('name') || fields.includes('ticker')
  const hasPosition = fields.includes('value') || fields.includes('quantity')

  // Hard disqualifiers: if the CSV also has clear transaction fields (date
  // and amount together), it's almost certainly a transaction export even if
  // some header happens to match a holdings pattern.
  const headerBlob = headers.join('|').toLowerCase()
  const looksLikeTransactionCsv =
    /\b(date|fecha|completed.?date)\b/i.test(headerBlob) &&
    /\b(amount|importe|debit|credit)\b/i.test(headerBlob)

  if (looksLikeTransactionCsv) return null

  return hasIdentifier && hasPosition ? result : null
}

/**
 * True when auto-detection found enough fields that manual column mapping
 * is not needed. Requires (name OR ticker) AND value AND quantity.
 */
export function isHoldingsMappingHighConfidence(
  mapping: Record<string, HoldingsSemanticField>
): boolean {
  const fields = Object.values(mapping)
  const hasIdentifier = fields.includes('name') || fields.includes('ticker')
  const hasValue = fields.includes('value')
  const hasQuantity = fields.includes('quantity')
  return hasIdentifier && hasValue && hasQuantity
}
