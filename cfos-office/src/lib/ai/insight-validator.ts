/**
 * Extract all numbers >= 10 from a narrative string, for validation against
 * a quotable-facts allowlist. Mirrors the judge's extraction regex so our
 * app-side guard matches the test harness.
 */
export function extractNumbers(text: string): number[] {
  // Strip currency symbols so "£3,300" -> "3,300", "€500" -> "500".
  const cleaned = text.replace(/[£€$¥]/g, '');
  // Match integers and decimals, allowing thousand-separator commas.
  const matches = cleaned.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) ?? [];
  return matches
    .map((m) => Number(m.replace(/,/g, '')))
    .filter((n) => Number.isFinite(n) && n >= 10);
}

/**
 * Return the subset of `knownMerchants` that appear as whole-word case-insensitive
 * matches in `text`. The input list is already normalised to lowercase by the
 * caller (the engine produces normalised merchant keys).
 */
export function extractMerchants(text: string, knownMerchants: string[]): string[] {
  if (knownMerchants.length === 0) return [];
  const lowered = text.toLowerCase();
  const seen = new Set<string>();
  for (const m of knownMerchants) {
    const re = new RegExp(`\\b${escapeRegex(m)}\\b`, 'i');
    if (re.test(lowered)) seen.add(m);
  }
  return Array.from(seen);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
