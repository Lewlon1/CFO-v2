import type { QuotableFact, ValidationResult } from '@/lib/analytics/insight-types';

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

export type ValidateOptions = {
  /**
   * Whole universe of merchant names present in the user's transactions. The
   * validator rejects any merchant in the narrative that is in this list but
   * NOT in any QuotableFact.merchants. When omitted, merchants are not checked.
   */
  knownMerchants?: string[];
};

export function validateNarrative(
  narrative: string,
  facts: QuotableFact[],
  opts: ValidateOptions = {},
): ValidationResult {
  const allowedNumbers = new Set<number>();
  const allowedMerchants = new Set<string>();
  for (const f of facts) {
    for (const n of f.numbers) allowedNumbers.add(n);
    for (const m of f.merchants) allowedMerchants.add(m.toLowerCase());
  }

  const cited = extractNumbers(narrative);
  // Allow ±1 tolerance — matches the judge's ±1-currency-unit grace and
  // tolerates legitimate rounding (e.g. £29.99 cited when allowlist has 30).
  const badNumbers = cited.filter((n) => {
    for (const allowed of allowedNumbers) {
      if (Math.abs(n - allowed) <= 1) return false;
    }
    return true;
  });
  if (badNumbers.length > 0) {
    return {
      ok: false,
      reason: 'numbers_not_allowed',
      offenders: badNumbers.map(String),
    };
  }

  if (opts.knownMerchants && opts.knownMerchants.length > 0) {
    const citedMerchants = extractMerchants(narrative, opts.knownMerchants);
    const badMerchants = citedMerchants.filter((m) => !allowedMerchants.has(m));
    if (badMerchants.length > 0) {
      return {
        ok: false,
        reason: 'merchants_not_allowed',
        offenders: badMerchants,
      };
    }
  }

  return { ok: true };
}
