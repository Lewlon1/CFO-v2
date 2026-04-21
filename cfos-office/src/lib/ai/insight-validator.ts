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
