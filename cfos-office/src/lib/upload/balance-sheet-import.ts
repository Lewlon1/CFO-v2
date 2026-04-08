// Commit step for balance-sheet uploads (Session 19B).
//
// Takes a user-reviewed payload from the HoldingsPreview component and
// writes it to `assets`, `liabilities`, and/or `investment_holdings`.
// Refreshes the financial portrait after a successful write.
//
// Duplicate detection keys:
//   asset     = (user_id, lower(name), asset_type) — provider is best-effort
//   liability = (user_id, lower(name), liability_type)
//   holding   = (asset_id, upper(ticker))  OR  (asset_id, lower(name)) when ticker is null

import type { SupabaseClient } from '@supabase/supabase-js'
import { updateAssetPortrait } from '@/lib/balance-sheet/portrait'
import { refreshCurrentNetWorthSnapshot } from '@/lib/analytics/net-worth-snapshot'
import type { ParsedHolding } from '@/lib/parsers/types'

type AssetType = 'savings' | 'stocks' | 'bonds' | 'pension' | 'crypto' | 'property' | 'other'
type LiabilityType =
  | 'mortgage'
  | 'student_loan'
  | 'credit_card'
  | 'personal_loan'
  | 'car_finance'
  | 'bnpl'
  | 'overdraft'
  | 'other'

export type BalanceSheetSource = 'csv_upload' | 'screenshot' | 'pdf'

export type ConfirmedHoldingsImport = {
  import_type: 'holdings'
  source: BalanceSheetSource
  asset_name: string
  asset_type: Extract<AssetType, 'stocks' | 'bonds' | 'crypto' | 'pension'>
  provider: string | null
  currency: string
  holdings: ParsedHolding[]
}

export type ConfirmedSingleAssetImport = {
  import_type: 'single_asset'
  source: BalanceSheetSource
  asset: {
    name: string
    asset_type: AssetType
    provider: string | null
    currency: string
    current_value: number
    cost_basis?: number | null
    details?: Record<string, unknown>
  }
}

export type ConfirmedLiabilityImport = {
  import_type: 'liability'
  source: BalanceSheetSource
  liability: {
    name: string
    liability_type: LiabilityType
    provider: string | null
    currency: string
    outstanding_balance: number
    interest_rate?: number | null
    minimum_payment?: number | null
    monthly_payment?: number | null
    remaining_term_months?: number | null
    details?: Record<string, unknown>
  }
}

export type ConfirmedBalanceSheetImport =
  | ConfirmedHoldingsImport
  | ConfirmedSingleAssetImport
  | ConfirmedLiabilityImport

export type ImportSummary = {
  assets_created: number
  assets_updated: number
  liabilities_created: number
  liabilities_updated: number
  holdings_created: number
  holdings_updated: number
}

export type RunBalanceSheetImportResult =
  | { ok: true; summary: ImportSummary }
  | { ok: false; error: string }

function emptySummary(): ImportSummary {
  return {
    assets_created: 0,
    assets_updated: 0,
    liabilities_created: 0,
    liabilities_updated: 0,
    holdings_created: 0,
    holdings_updated: 0,
  }
}

export async function runBalanceSheetImport(
  supabase: SupabaseClient,
  userId: string,
  payload: ConfirmedBalanceSheetImport
): Promise<RunBalanceSheetImportResult> {
  try {
    const summary = emptySummary()
    const nowIso = new Date().toISOString()

    if (payload.import_type === 'holdings') {
      if (!payload.asset_name || !payload.asset_type) {
        return { ok: false, error: 'Missing account name or asset type.' }
      }

      // Find or create parent asset
      const { data: existingAssets, error: lookupErr } = await supabase
        .from('assets')
        .select('id, current_value, cost_basis')
        .eq('user_id', userId)
        .eq('asset_type', payload.asset_type)
        .ilike('name', payload.asset_name)
        .limit(1)

      if (lookupErr) {
        console.error('[balance-sheet-import] asset lookup error:', lookupErr)
        return { ok: false, error: 'Could not look up existing assets.' }
      }

      let assetId: string
      if (existingAssets && existingAssets.length > 0) {
        assetId = existingAssets[0].id
        summary.assets_updated += 1
      } else {
        const { data: inserted, error: insertErr } = await supabase
          .from('assets')
          .insert({
            user_id: userId,
            asset_type: payload.asset_type,
            name: payload.asset_name,
            provider: payload.provider ?? null,
            currency: payload.currency.toUpperCase(),
            current_value: null,
            cost_basis: null,
            details: {},
            is_accessible: payload.asset_type !== 'pension',
            source: payload.source,
            last_updated: nowIso,
          })
          .select('id')
          .single()

        if (insertErr || !inserted) {
          console.error('[balance-sheet-import] asset insert error:', insertErr)
          return { ok: false, error: 'Could not create parent asset.' }
        }
        assetId = inserted.id
        summary.assets_created += 1
      }

      // Upsert each holding
      for (const h of payload.holdings) {
        const { data: existingHoldings, error: holdingLookupErr } = await supabase
          .from('investment_holdings')
          .select('id')
          .eq('asset_id', assetId)
          .eq(h.ticker ? 'ticker' : 'name', (h.ticker ?? h.name))
          .limit(1)

        if (holdingLookupErr) {
          console.error('[balance-sheet-import] holding lookup error:', holdingLookupErr)
          continue
        }

        const holdingData = {
          user_id: userId,
          asset_id: assetId,
          ticker: h.ticker,
          name: h.name,
          asset_type: h.asset_type_hint ?? payload.asset_type,
          quantity: h.quantity,
          current_value: h.current_value,
          cost_basis: h.cost_basis,
          currency: (h.currency || payload.currency).toUpperCase(),
          gain_loss_pct: h.gain_loss_pct,
          last_updated: nowIso,
        }

        if (existingHoldings && existingHoldings.length > 0) {
          const { error: updateErr } = await supabase
            .from('investment_holdings')
            .update(holdingData)
            .eq('id', existingHoldings[0].id)
          if (updateErr) {
            console.error('[balance-sheet-import] holding update error:', updateErr)
            continue
          }
          summary.holdings_updated += 1
        } else {
          const { error: insertErr } = await supabase
            .from('investment_holdings')
            .insert(holdingData)
          if (insertErr) {
            console.error('[balance-sheet-import] holding insert error:', insertErr)
            continue
          }
          summary.holdings_created += 1
        }
      }

      // Recompute parent asset totals from all its holdings
      const { data: allHoldings } = await supabase
        .from('investment_holdings')
        .select('current_value, cost_basis')
        .eq('asset_id', assetId)

      if (allHoldings) {
        const totalValue = allHoldings.reduce(
          (sum, h) => sum + (typeof h.current_value === 'number' ? h.current_value : 0),
          0
        )
        const totalCost = allHoldings.reduce(
          (sum, h) => sum + (typeof h.cost_basis === 'number' ? h.cost_basis : 0),
          0
        )
        await supabase
          .from('assets')
          .update({
            current_value: totalValue || null,
            cost_basis: totalCost || null,
            last_updated: nowIso,
          })
          .eq('id', assetId)
      }
    } else if (payload.import_type === 'single_asset') {
      const a = payload.asset
      if (!a.name || !a.asset_type || typeof a.current_value !== 'number') {
        return { ok: false, error: 'Missing asset name, type, or value.' }
      }

      const { data: existing, error: lookupErr } = await supabase
        .from('assets')
        .select('id')
        .eq('user_id', userId)
        .eq('asset_type', a.asset_type)
        .ilike('name', a.name)
        .limit(1)

      if (lookupErr) {
        return { ok: false, error: 'Could not look up existing assets.' }
      }

      const baseData = {
        asset_type: a.asset_type,
        name: a.name,
        provider: a.provider ?? null,
        currency: a.currency.toUpperCase(),
        current_value: a.current_value,
        cost_basis: a.cost_basis ?? null,
        details: a.details ?? {},
        last_updated: nowIso,
      }

      if (existing && existing.length > 0) {
        const { error } = await supabase
          .from('assets')
          .update(baseData)
          .eq('id', existing[0].id)
        if (error) return { ok: false, error: 'Could not update asset.' }
        summary.assets_updated += 1
      } else {
        const { error } = await supabase.from('assets').insert({
          ...baseData,
          user_id: userId,
          is_accessible: a.asset_type !== 'pension' && a.asset_type !== 'property',
          source: payload.source,
        })
        if (error) {
          console.error('[balance-sheet-import] single asset insert error:', error)
          return { ok: false, error: 'Could not create asset.' }
        }
        summary.assets_created += 1
      }
    } else if (payload.import_type === 'liability') {
      const l = payload.liability
      if (!l.name || !l.liability_type || typeof l.outstanding_balance !== 'number') {
        return { ok: false, error: 'Missing liability name, type, or balance.' }
      }

      const { data: existing, error: lookupErr } = await supabase
        .from('liabilities')
        .select('id')
        .eq('user_id', userId)
        .eq('liability_type', l.liability_type)
        .ilike('name', l.name)
        .limit(1)

      if (lookupErr) {
        return { ok: false, error: 'Could not look up existing liabilities.' }
      }

      const baseData = {
        liability_type: l.liability_type,
        name: l.name,
        provider: l.provider ?? null,
        currency: l.currency.toUpperCase(),
        outstanding_balance: l.outstanding_balance,
        interest_rate: l.interest_rate ?? null,
        minimum_payment: l.minimum_payment ?? null,
        actual_payment: l.monthly_payment ?? null,
        remaining_term_months: l.remaining_term_months ?? null,
        details: l.details ?? {},
        last_updated: nowIso,
      }

      if (existing && existing.length > 0) {
        const { error } = await supabase
          .from('liabilities')
          .update(baseData)
          .eq('id', existing[0].id)
        if (error) return { ok: false, error: 'Could not update liability.' }
        summary.liabilities_updated += 1
      } else {
        const { error } = await supabase.from('liabilities').insert({
          ...baseData,
          user_id: userId,
          payment_frequency: 'monthly',
          source: payload.source,
        })
        if (error) {
          console.error('[balance-sheet-import] liability insert error:', error)
          return { ok: false, error: 'Could not create liability.' }
        }
        summary.liabilities_created += 1
      }
    } else {
      return { ok: false, error: 'Unknown import type.' }
    }

    // Refresh the balance-sheet-derived portrait traits.
    await updateAssetPortrait({ supabase, userId })

    // Refresh the current month's net-worth snapshot so the Balance Sheet page
    // reflects the new totals immediately.
    await refreshCurrentNetWorthSnapshot(supabase, userId)

    return { ok: true, summary }
  } catch (err) {
    console.error('[balance-sheet-import] unexpected error:', err)
    return { ok: false, error: 'Something went wrong saving the import.' }
  }
}
