import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Asset = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Liability = Record<string, any>;

interface PortraitCtx {
  supabase: SupabaseClient;
  userId: string;
}

interface TraitRow {
  trait_key: string;
  trait_value: string;
}

const HIGH_INTEREST_THRESHOLD = 15; // APR %

// Liabilities of these types are treated as high-interest when no APR is on
// file. Credit cards, overdrafts, and BNPL almost always carry rates well
// above the 15% threshold; assuming benign rates when the data is missing is
// the bug that left prod users with `has_high_interest_debt = no` despite
// declared credit-card balances.
const HIGH_INTEREST_TYPES_WHEN_NULL_RATE = ['credit_card', 'overdraft', 'bnpl'] as const;

/**
 * Recompute and upsert the balance-sheet-derived traits in financial_portrait.
 *
 * Called after every successful upsert_asset / upsert_liability tool run.
 * All writes are idempotent via the (user_id, trait_key) unique constraint —
 * we overwrite rather than merge, so stale traits are always refreshed.
 *
 * Never throws. A portrait-write failure must never break the tool's main
 * action; we log and move on.
 */
export async function updateAssetPortrait(ctx: PortraitCtx): Promise<void> {
  try {
    const [assetsResult, liabilitiesResult] = await Promise.all([
      ctx.supabase.from('assets').select('*').eq('user_id', ctx.userId),
      ctx.supabase.from('liabilities').select('*').eq('user_id', ctx.userId),
    ]);

    if (assetsResult.error) {
      console.error('[balance-sheet/portrait] assets fetch error:', assetsResult.error);
      return;
    }
    if (liabilitiesResult.error) {
      console.error('[balance-sheet/portrait] liabilities fetch error:', liabilitiesResult.error);
      return;
    }

    const assets: Asset[] = assetsResult.data || [];
    const liabilities: Liability[] = liabilitiesResult.data || [];

    const traits = computeTraits(assets, liabilities);

    const totalAssets = sumBy(assets, (a) => Number(a.current_value) || 0);
    const totalLiabilities = sumBy(liabilities, (l) => Number(l.outstanding_balance) || 0);
    const evidence = JSON.stringify({
      total_assets: round2(totalAssets),
      total_liabilities: round2(totalLiabilities),
      asset_count: assets.length,
      liability_count: liabilities.length,
      computed_at: new Date().toISOString(),
    });

    for (const { trait_key, trait_value } of traits) {
      const { error } = await ctx.supabase.from('financial_portrait').upsert(
        {
          user_id: ctx.userId,
          trait_type: 'asset_profile',
          trait_key,
          trait_value,
          confidence: 1.0,
          evidence,
          source: 'balance_sheet',
        },
        { onConflict: 'user_id,trait_key' },
      );
      if (error) {
        console.error(`[balance-sheet/portrait] upsert error for ${trait_key}:`, error);
      }
    }
  } catch (err) {
    console.error('[balance-sheet/portrait] unexpected error:', err);
  }
}

export function computeTraits(assets: Asset[], liabilities: Liability[]): TraitRow[] {
  const rows: TraitRow[] = [];

  const hasAssetType = (type: string) => assets.some((a) => a.asset_type === type);
  const hasLiabilityType = (type: string) =>
    liabilities.some((l) => l.liability_type === type);

  rows.push({ trait_key: 'has_savings', trait_value: hasAssetType('savings') ? 'yes' : 'no' });
  rows.push({
    trait_key: 'has_investments',
    trait_value: hasAssetType('stocks') || hasAssetType('bonds') ? 'yes' : 'no',
  });
  rows.push({ trait_key: 'has_pension', trait_value: hasAssetType('pension') ? 'yes' : 'no' });
  rows.push({ trait_key: 'has_crypto', trait_value: hasAssetType('crypto') ? 'yes' : 'no' });

  // has_property — yes if a property asset OR a mortgage liability exists.
  // Mortgages without a paired asset row are still proof of property ownership.
  rows.push({
    trait_key: 'has_property',
    trait_value: hasAssetType('property') || hasLiabilityType('mortgage') ? 'yes' : 'no',
  });

  rows.push({ trait_key: 'has_debt', trait_value: liabilities.length > 0 ? 'yes' : 'no' });

  // has_high_interest_debt — qualifies on either explicit rate >= threshold,
  // or on type alone when the rate hasn't been declared (credit cards et al.
  // are assumed high-interest until proven otherwise).
  const flagged = liabilities
    .filter((l) => {
      const rate = Number(l.interest_rate);
      const hasExplicitRate = Number.isFinite(rate) && rate > 0;
      if (hasExplicitRate) return rate >= HIGH_INTEREST_THRESHOLD;
      return HIGH_INTEREST_TYPES_WHEN_NULL_RATE.includes(
        l.liability_type as typeof HIGH_INTEREST_TYPES_WHEN_NULL_RATE[number],
      );
    })
    .sort((a, b) => (Number(b.interest_rate) || 0) - (Number(a.interest_rate) || 0));

  if (flagged.length > 0) {
    const worst = flagged[0];
    const rate = Number(worst.interest_rate);
    const trait_value =
      Number.isFinite(rate) && rate > 0
        ? `${worst.name} at ${rate}% APR`
        : `${worst.name} (rate not declared — treated as high-interest)`;
    rows.push({ trait_key: 'has_high_interest_debt', trait_value });
  } else {
    rows.push({ trait_key: 'has_high_interest_debt', trait_value: 'no' });
  }

  // asset_allocation_summary — only if we have assets with values
  const totalAssets = sumBy(assets, (a) => Number(a.current_value) || 0);
  if (totalAssets > 0) {
    const byType = new Map<string, number>();
    for (const a of assets) {
      const key = a.asset_type || 'other';
      byType.set(key, (byType.get(key) || 0) + (Number(a.current_value) || 0));
    }
    const parts = Array.from(byType.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type, value]) => `${type}: ${Math.round((value / totalAssets) * 100)}%`);
    rows.push({ trait_key: 'asset_allocation_summary', trait_value: parts.join(', ') });
  }

  // net_worth_bracket — 'unknown' when the user hasn't declared any assets.
  // Otherwise compute against the actual asset/liability totals. A user with
  // only debt declared shouldn't be branded 'negative net worth' — the assets
  // simply haven't been entered yet.
  if (assets.length === 0) {
    rows.push({ trait_key: 'net_worth_bracket', trait_value: 'unknown' });
  } else {
    const totalLiabs = sumBy(liabilities, (l) => Number(l.outstanding_balance) || 0);
    const netWorth = totalAssets - totalLiabs;
    let bracket: string;
    if (netWorth < 0) bracket = 'negative';
    else if (netWorth < 10_000) bracket = 'under_10k';
    else if (netWorth < 50_000) bracket = '10k_50k';
    else if (netWorth < 100_000) bracket = '50k_100k';
    else bracket = '100k_plus';
    rows.push({ trait_key: 'net_worth_bracket', trait_value: bracket });
  }

  return rows;
}

function sumBy<T>(items: T[], fn: (item: T) => number): number {
  return items.reduce((sum, item) => sum + fn(item), 0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
