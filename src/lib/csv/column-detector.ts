export type SemanticField =
  | "date"
  | "amount"
  | "description"
  | "merchant"
  | "type"
  | "category"
  | "currency"
  | "skip"

const FIELD_PATTERNS: Record<Exclude<SemanticField, "skip">, RegExp[]> = {
  date: [
    /^fecha/i,
    /^date/i,
    /^datum/i,
    /^data$/i,
    /^f\.?oper/i,
    /^value.?date/i,
    /^transaction.?date/i,
    /^booking/i,
    /completed.?date/i,
    /settlement.?date/i,
    /posting.?date/i,
    /effective.?date/i,
    /date$/i,
  ],
  amount: [
    /^importe/i,
    /^amount/i,
    /^betrag/i,
    /^montant/i,
    /^monto/i,
    /^cantidad/i,
    /^cargo/i,
    /^abono/i,
    /^valor/i,
    /^sum$/i,
  ],
  description: [
    /^concepto/i,
    /^descripci/i,
    /^description/i,
    /^details/i,
    /^memo/i,
    /^reference/i,
    /^remarque/i,
    /^motivo/i,
    /^concept/i,
    /^narrative/i,
  ],
  merchant: [
    /^comercio/i,
    /^merchant/i,
    /^benefici/i,
    /^tienda/i,
    /^estableci/i,
    /^payee/i,
    /^receptor/i,
    /^destinatario/i,
    /^name$/i,
  ],
  type: [
    /^tipo/i,
    /^type/i,
    /^movimiento/i,
    /^nature/i,
  ],
  category: [
    /^category/i,
    /^categoria/i,
    /^categor[ií]a/i,
    /^kategorie/i,
    /^catégorie/i,
  ],
  currency: [
    /^moneda/i,
    /^currency/i,
    /^devise/i,
    /^währung/i,
    /^curr$/i,
  ],
}

/**
 * Auto-detects the semantic meaning of each CSV column header.
 * Returns a mapping of { columnHeader: semanticField }.
 */
export function detectColumnMapping(
  headers: string[]
): Record<string, SemanticField> {
  const result: Record<string, SemanticField> = {}
  const usedFields = new Set<SemanticField>()

  for (const header of headers) {
    let detected: SemanticField = "skip"
    const trimmed = header.trim()

    for (const [field, patterns] of Object.entries(FIELD_PATTERNS) as [
      Exclude<SemanticField, "skip">,
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

  return result
}

/**
 * Returns true when auto-detection found the minimum required fields
 * (date + amount + at least description or merchant) — safe to skip
 * the manual column mapper step.
 */
export function isMappingHighConfidence(
  mapping: Record<string, SemanticField>
): boolean {
  const fields = Object.values(mapping)
  const hasDate = fields.filter((f) => f === "date").length === 1
  const hasAmount = fields.filter((f) => f === "amount").length === 1
  const hasDescOrMerchant =
    fields.includes("description") || fields.includes("merchant")
  return hasDate && hasAmount && hasDescOrMerchant
}

export const SEMANTIC_FIELD_LABELS: Record<SemanticField, string> = {
  date: "Date",
  amount: "Amount",
  description: "Description",
  merchant: "Merchant",
  type: "Type (income/expense)",
  category: "Category",
  currency: "Currency",
  skip: "Skip this column",
}
