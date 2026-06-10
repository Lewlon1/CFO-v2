/**
 * Resolve the user's currency.
 *
 * FINDINGS.md bug #2: `user_profiles.primary_currency` schema-defaults to
 * 'EUR' regardless of country, and the onboarding flow never asks. A UK
 * user therefore ends up with country='GB' but primary_currency='EUR',
 * and the first-insight narration renders "€" symbols on GBP data.
 *
 * Resolution order:
 *   1. profile.primary_currency, IF the user has set it to a non-default value
 *   2. dominant currency in the user's transactions (set by CSV upload)
 *   3. country-inferred currency (GB→GBP, US→USD, etc.)
 *   4. profile.primary_currency (even if it's the schema default 'EUR')
 *   5. 'EUR' final fallback
 *
 * The transactions check is the strongest signal post-CSV-upload — the parser
 * has already attached the per-row currency from the bank statement.
 */
export function resolveUserCurrency(
  country: string | null,
  profileCurrency: string | null,
  transactions: Array<{ currency?: string | null }> = [],
): string {
  const COUNTRY_CURRENCY: Record<string, string> = {
    GB: 'GBP',
    US: 'USD',
    CA: 'CAD',
    AU: 'AUD',
  };

  // 1. User has explicitly chosen a non-default currency — trust it.
  if (profileCurrency && profileCurrency !== 'EUR') {
    return profileCurrency;
  }

  // 2. Dominant currency in transactions (post-CSV upload signal).
  const txCurrency = dominantTransactionCurrency(transactions);
  if (txCurrency) return txCurrency;

  // 3. Country lookup.
  const inferred = country ? COUNTRY_CURRENCY[country.toUpperCase()] : null;
  if (inferred) return inferred;

  // 4 & 5: profile (likely 'EUR'), then hard fallback.
  return profileCurrency ?? 'EUR';
}

function dominantTransactionCurrency(
  transactions: Array<{ currency?: string | null }>,
): string | null {
  if (transactions.length < 5) return null;
  const counts = new Map<string, number>();
  for (const t of transactions) {
    if (!t.currency) continue;
    const c = t.currency.toUpperCase();
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let best: { c: string; n: number } | null = null;
  for (const [c, n] of counts) {
    if (!best || n > best.n) best = { c, n };
  }
  // Require dominance — at least 70% of transactions in a single currency.
  if (best && best.n / transactions.length >= 0.7) return best.c;
  return null;
}
