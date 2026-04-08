// Net worth snapshot computation.
//
// Called in-process from balance-sheet write paths (upsert_asset, upsert_liability,
// runBalanceSheetImport) to keep `net_worth_snapshots` up to date for the current month.
//
// Multi-currency note: this implementation sums values at face value across currencies.
// A user with £55k in a UK ISA and €12k in Spanish savings will see those summed without
// FX conversion. This is a documented MVP limitation.
//
// Future cron note: when a monthly cron is added, it should call this function for every
// user that has any rows in `assets` or `liabilities`.

import type { SupabaseClient } from '@supabase/supabase-js';

function getPreviousMonth(monthStr: string): string {
  // monthStr is 'YYYY-MM-01'
  const [yStr, mStr] = monthStr.split('-');
  let y = Number(yStr);
  let m = Number(mStr) - 1;
  if (m === 0) {
    m = 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

export function currentMonthStart(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

export async function computeNetWorthSnapshot(
  supabase: SupabaseClient,
  userId: string,
  month: string // 'YYYY-MM-01'
): Promise<void> {
  const [{ data: assets, error: assetsErr }, { data: liabilities, error: liabilitiesErr }] =
    await Promise.all([
      supabase
        .from('assets')
        .select('asset_type, current_value, is_accessible, currency')
        .eq('user_id', userId),
      supabase
        .from('liabilities')
        .select('liability_type, outstanding_balance, currency')
        .eq('user_id', userId),
    ]);

  if (assetsErr) {
    console.error('[net-worth-snapshot] assets fetch error:', assetsErr);
    return;
  }
  if (liabilitiesErr) {
    console.error('[net-worth-snapshot] liabilities fetch error:', liabilitiesErr);
    return;
  }

  const assetsList = assets || [];
  const liabilitiesList = liabilities || [];

  if (assetsList.length === 0 && liabilitiesList.length === 0) {
    return; // Nothing to snapshot
  }

  const totalAssets = assetsList.reduce((s, a) => s + (Number(a.current_value) || 0), 0);
  const totalLiabilities = liabilitiesList.reduce(
    (s, l) => s + (Number(l.outstanding_balance) || 0),
    0
  );
  const netWorth = totalAssets - totalLiabilities;

  const accessibleAssets = assetsList
    .filter((a) => a.is_accessible)
    .reduce((s, a) => s + (Number(a.current_value) || 0), 0);
  const lockedAssets = totalAssets - accessibleAssets;

  const assetsByType: Record<string, number> = {};
  for (const a of assetsList) {
    const v = Number(a.current_value) || 0;
    assetsByType[a.asset_type] = (assetsByType[a.asset_type] || 0) + v;
  }
  for (const k of Object.keys(assetsByType)) {
    assetsByType[k] = Math.round(assetsByType[k] * 100) / 100;
  }

  const liabilitiesByType: Record<string, number> = {};
  for (const l of liabilitiesList) {
    const v = Number(l.outstanding_balance) || 0;
    liabilitiesByType[l.liability_type] = (liabilitiesByType[l.liability_type] || 0) + v;
  }
  for (const k of Object.keys(liabilitiesByType)) {
    liabilitiesByType[k] = Math.round(liabilitiesByType[k] * 100) / 100;
  }

  // Previous month delta
  const prevMonth = getPreviousMonth(month);
  const { data: prevSnapshot } = await supabase
    .from('net_worth_snapshots')
    .select('net_worth')
    .eq('user_id', userId)
    .eq('month', prevMonth)
    .maybeSingle();

  let netWorthChange: number | null = null;
  let netWorthChangePct: number | null = null;
  if (prevSnapshot && prevSnapshot.net_worth != null) {
    const prev = Number(prevSnapshot.net_worth);
    netWorthChange = Math.round((netWorth - prev) * 100) / 100;
    if (prev !== 0) {
      netWorthChangePct = Math.round(((netWorth - prev) / Math.abs(prev)) * 1000) / 10;
    }
  }

  const { error: upsertErr } = await supabase.from('net_worth_snapshots').upsert(
    {
      user_id: userId,
      month,
      total_assets: Math.round(totalAssets * 100) / 100,
      total_liabilities: Math.round(totalLiabilities * 100) / 100,
      net_worth: Math.round(netWorth * 100) / 100,
      assets_by_type: assetsByType,
      liabilities_by_type: liabilitiesByType,
      accessible_assets: Math.round(accessibleAssets * 100) / 100,
      locked_assets: Math.round(lockedAssets * 100) / 100,
      net_worth_change: netWorthChange,
      net_worth_change_pct: netWorthChangePct,
    },
    { onConflict: 'user_id,month' }
  );

  if (upsertErr) {
    console.error('[net-worth-snapshot] upsert error:', upsertErr);
  }
}

/**
 * Safe wrapper that swallows errors so it can be called from write paths
 * without ever breaking the parent operation.
 */
export async function refreshCurrentNetWorthSnapshot(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  try {
    await computeNetWorthSnapshot(supabase, userId, currentMonthStart());
  } catch (err) {
    console.error('[net-worth-snapshot] refresh failed (non-fatal):', err);
  }
}
