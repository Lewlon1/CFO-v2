/**
 * Quick merchant normalisation: strip bank-side prefixes and standardise whitespace.
 * Does NOT attempt brand-level rollup (e.g. POLLO TROPICAL #142 and POLLO TROPICAL DRIVE THRU
 * remain distinct after stripping the POS PURCHASE prefix). Brand rollup is handled at the
 * query layer in cluster-behaviour/queries.ts via substring ILIKE match.
 *
 * Rationale: the Session A audit found that descriptions carry bank prefixes (POS PURCHASE,
 * ATM WITHDRAWAL, DIRECT DEP) that obscure the actual merchant. Stripping these is a cheap,
 * deterministic win that produces clean strings for display in the first-Read composition
 * prompt — the model should see "POLLO TROPICAL #142" rather than the raw
 * "POS PURCHASE POLLO TROPICAL #142".
 */

const BANK_PREFIXES: RegExp[] = [
  /^POS\s+PURCHASE\s+/i,
  /^POS\s+/i,
  /^ATM\s+WITHDRAWAL\s+/i,
  /^ATM\s+/i,
  /^DIRECT\s+DEP(OSIT)?\s+/i,
  /^DEBIT\s+CARD\s+PURCHASE\s+/i,
  /^CREDIT\s+CARD\s+PURCHASE\s+/i,
  /^CARD\s+PURCHASE\s+/i,
  /^DEBIT\s+/i,
  /^CREDIT\s+/i,
  /^PURCHASE\s+/i,
  /^CONTACTLESS\s+/i,
  /^ONLINE\s+/i,
];

const TRAILING_NOISE: RegExp[] = [
  /\s+REF\s*[\d-]+$/i,
  /\s+\d{6,}$/,
];

/**
 * Strip prefix and trailing noise. Collapse whitespace. Trim.
 * Returns the normalised form; does not lowercase (preserves brand casing).
 *
 * Examples:
 *   "POS PURCHASE POLLO TROPICAL #142"      → "POLLO TROPICAL #142"
 *   "ATM WITHDRAWAL FIRSTBANK CAROLINA 003" → "FIRSTBANK CAROLINA 003"
 *   "POS Purchase Pret a Manger LDN"        → "Pret a Manger LDN"
 */
export function normaliseMerchantDescription(raw: string): string {
  if (!raw) return raw;
  let s = raw;

  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of BANK_PREFIXES) {
      const after = s.replace(prefix, '');
      if (after !== s) {
        s = after;
        changed = true;
        break;
      }
    }
  }

  for (const trail of TRAILING_NOISE) {
    s = s.replace(trail, '');
  }

  s = s.replace(/\s+/g, ' ').trim();

  return s;
}
