import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export type HoldingRow = {
  id: string
  ticker: string | null
  name: string
  asset_type: string | null
  quantity: number | null
  current_value: number | null
  cost_basis: number | null
  currency: string | null
  gain_loss_pct: number | null
  allocation_pct: number | null
  last_updated: string | null
}

export type HoldingsResponse = {
  asset_id: string
  asset_name: string
  asset_currency: string
  asset_total: number
  holdings: HoldingRow[]
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const assetId = req.nextUrl.searchParams.get('asset_id')
  if (!assetId) return NextResponse.json({ error: 'asset_id is required' }, { status: 400 })

  const { data: asset, error: assetErr } = await supabase
    .from('assets')
    .select('id, name, currency, current_value')
    .eq('id', assetId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (assetErr) {
    console.error('[api/balance-sheet/holdings] asset fetch error:', assetErr)
    return NextResponse.json({ error: 'Could not load asset' }, { status: 500 })
  }
  if (!asset) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
  }

  const { data: holdings, error: holdingsErr } = await supabase
    .from('investment_holdings')
    .select('id, ticker, name, asset_type, quantity, current_value, cost_basis, currency, gain_loss_pct, last_updated')
    .eq('asset_id', assetId)
    .eq('user_id', user.id)
    .order('current_value', { ascending: false })

  if (holdingsErr) {
    console.error('[api/balance-sheet/holdings] holdings fetch error:', holdingsErr)
    return NextResponse.json({ error: 'Could not load holdings' }, { status: 500 })
  }

  const assetTotal = Number(asset.current_value) || 0

  const rows: HoldingRow[] = (holdings || []).map((h) => {
    const cv = h.current_value != null ? Number(h.current_value) : null
    const cb = h.cost_basis != null ? Number(h.cost_basis) : null
    const gainLossPct =
      h.gain_loss_pct != null
        ? Number(h.gain_loss_pct)
        : cv != null && cb != null && cb > 0
          ? Math.round(((cv - cb) / cb) * 1000) / 10
          : null
    const allocationPct =
      cv != null && assetTotal > 0 ? Math.round((cv / assetTotal) * 1000) / 10 : null
    return {
      id: h.id,
      ticker: h.ticker,
      name: h.name,
      asset_type: h.asset_type,
      quantity: h.quantity != null ? Number(h.quantity) : null,
      current_value: cv,
      cost_basis: cb,
      currency: h.currency,
      gain_loss_pct: gainLossPct,
      allocation_pct: allocationPct,
      last_updated: h.last_updated,
    }
  })

  const response: HoldingsResponse = {
    asset_id: asset.id,
    asset_name: asset.name,
    asset_currency: asset.currency || 'EUR',
    asset_total: assetTotal,
    holdings: rows,
  }

  return NextResponse.json(response)
}
