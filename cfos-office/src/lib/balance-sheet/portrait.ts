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

function computeTraits(assets: Asset[], liabilities: Liability[]): TraitRow[] {
  const rows: TraitRow[] = [];

  const hasType = (type: string) => assets.some((a) => a.asset_type === type);
  rows.push({ trait_key: 'has_savings', trait_value: hasType('savings') ? 'yes' : 'no' });
  rows.push({
    trait_key: 'has_investments',
    trait_value: hasType('stocks') || hasType('bonds') ? 'yes' : 'no',
  });
  rows.push({ trait_key: 'has_pension', trait_value: hasType('pension') ? 'yes' : 'no' });
  rows.push({ trait_key: 'has_crypto', trait_value: hasType('crypto') ? 'yes' : 'no' });
  rows.push({ trait_key: 'has_property', trait_value: hasType('property') ? 'yes' : 'no' });
  rows.push({ trait_key: 'has_debt', trait_value: liabilities.length > 0 ? 'yes' : 'no' });

  // has_high_interest_debt — name + rate of the worst offender
  const highInterest = liabilities
    .filter((l) => Number(l.interest_rate) > HIGH_INTEREST_THRESHOLD)
    .sort((a, b) => Number(b.interest_rate) - Number(a.interest_rate));
  if (highInterest.length > 0) {
    const worst = highInterest[0];
    rows.push({
      trait_key: 'has_high_interest_debt',
      trait_value: `${worst.name} at ${Number(worst.interest_rate)}% APR`,
    });
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

  // net_worth_bracket
  if (assets.length > 0 || liabilities.length > 0) {
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
