import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Display metadata for asset/liability types — kept server-side so the API
// payload can be rendered without the client needing the full type registry.
const ASSET_TYPE_META: Record<string, { label: string; icon: string; color: string; order: number }> = {
  savings:  { label: 'Savings',     icon: 'piggy-bank',     color: '#10B981', order: 1 },
  stocks:   { label: 'Stocks',      icon: 'trending-up',    color: '#6366F1', order: 2 },
  bonds:    { label: 'Bonds',       icon: 'shield',         color: '#8B5CF6', order: 3 },
  pension:  { label: 'Pensions',    icon: 'landmark',       color: '#F59E0B', order: 4 },
  crypto:   { label: 'Crypto',      icon: 'bitcoin',        color: '#F97316', order: 5 },
  property: { label: 'Property',    icon: 'home',           color: '#06B6D4', order: 6 },
  other:    { label: 'Other',       icon: 'package',        color: '#6B7280', order: 7 },
}

const LIABILITY_TYPE_META: Record<string, { label: string; icon: string; color: string; order: number }> = {
  mortgage:      { label: 'Mortgage',          icon: 'home',           color: '#EF4444', order: 1 },
  student_loan:  { label: 'Student Loan',      icon: 'graduation-cap', color: '#F97316', order: 2 },
  credit_card:   { label: 'Credit Cards',      icon: 'credit-card',    color: '#DC2626', order: 3 },
  personal_loan: { label: 'Personal Loan',     icon: 'banknote',       color: '#E11D48', order: 4 },
  car_finance:   { label: 'Car Finance',       icon: 'car',            color: '#D97706', order: 5 },
  bnpl:          { label: 'Buy Now Pay Later', icon: 'shopping-bag',   color: '#EA580C', order: 6 },
  overdraft:     { label: 'Overdraft',         icon: 'alert-circle',   color: '#B91C1C', order: 7 },
  other:         { label: 'Other Debt',        icon: 'package',        color: '#6B7280', order: 8 },
}

const STALE_DAYS = 90

export type BalanceSheetAssetItem = {
  id: string
  name: string
  provider: string | null
  current_value: number
  cost_basis: number | null
  gain_loss_pct: number | null
  currency: string
  is_accessible: boolean
  last_updated: string
  is_stale: boolean
  holdings_count: number
}

export type BalanceSheetAssetGroup = {
  type: string
  label: string
  icon: string
  color: string
  total: number
  items: BalanceSheetAssetItem[]
}

export type BalanceSheetLiabilityItem = {
  id: string
  name: string
  provider: string | null
  outstanding_balance: number
  interest_rate: number | null
  actual_payment: number | null
  minimum_payment: number | null
  payment_frequency: string
  currency: string
  is_priority: boolean
  last_updated: string
  is_stale: boolean
  monthly_interest: number | null
}

export type BalanceSheetLiabilityGroup = {
  type: string
  label: string
  icon: string
  color: string
  total: number
  items: BalanceSheetLiabilityItem[]
}

export type AllocationSlice = {
  type: string
  label: string
  value: number
  color: string
  pct: number
}

export type DataGap = {
  type: string
  message: string
  action_label: string
  action_href: string
  severity: 'info' | 'warning'
}

export type TrendPoint = {
  month: string
  net_worth: number
  total_assets: number
  total_liabilities: number
}

export type BalanceSheetResponse = {
  net_worth: number
  total_assets: number
  total_liabilities: number
  accessible_assets: number
  locked_assets: number
  net_worth_change: number | null
  net_worth_change_pct: number | null
  asset_groups: BalanceSheetAssetGroup[]
  liability_groups: BalanceSheetLiabilityGroup[]
  allocation: AllocationSlice[]
  data_gaps: DataGap[]
  trend: TrendPoint[]
  currency: string
  has_data: boolean
}

function isStale(lastUpdated: string | null | undefined): boolean {
  if (!lastUpdated) return false
  const updated = new Date(lastUpdated).getTime()
  const ageMs = Date.now() - updated
  return ageMs > STALE_DAYS * 24 * 60 * 60 * 1000
}

function emptyResponse(currency: string): BalanceSheetResponse {
  return {
    net_worth: 0,
    total_assets: 0,
    total_liabilities: 0,
    accessible_assets: 0,
    locked_assets: 0,
    net_worth_change: null,
    net_worth_change_pct: null,
    asset_groups: [],
    liability_groups: [],
    allocation: [],
    data_gaps: [
      {
        type: 'no_data',
        message: 'Your CFO doesn\u2019t know what you own or owe yet',
        action_label: 'Tell your CFO \u2192',
        action_href: '/chat?topic=balance_sheet_setup',
        severity: 'info',
      },
    ],
    trend: [],
    currency,
    has_data: false,
  }
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('primary_currency')
    .eq('id', user.id)
    .maybeSingle()
  const currency = profile?.primary_currency || 'EUR'

  // Fetch assets, liabilities, and snapshot history in parallel
  const [assetsRes, liabilitiesRes, holdingsCountRes, snapshotsRes] = await Promise.all([
    supabase
      .from('assets')
      .select('id, asset_type, name, provider, currency, current_value, cost_basis, is_accessible, last_updated')
      .eq('user_id', user.id)
      .order('current_value', { ascending: false }),
    supabase
      .from('liabilities')
      .select(
        'id, liability_type, name, provider, currency, outstanding_balance, interest_rate, actual_payment, minimum_payment, payment_frequency, is_priority, last_updated'
      )
      .eq('user_id', user.id)
      .order('outstanding_balance', { ascending: false }),
    supabase.from('investment_holdings').select('asset_id').eq('user_id', user.id),
    supabase
      .from('net_worth_snapshots')
      .select(
        'month, net_worth, total_assets, total_liabilities, net_worth_change, net_worth_change_pct'
      )
      .eq('user_id', user.id)
      .order('month', { ascending: false })
      .limit(12),
  ])

  if (assetsRes.error || liabilitiesRes.error) {
    console.error('[api/balance-sheet] fetch error:', assetsRes.error || liabilitiesRes.error)
    return NextResponse.json({ error: 'Could not load balance sheet' }, { status: 500 })
  }

  const assets = assetsRes.data || []
  const liabilities = liabilitiesRes.data || []
  const holdings = holdingsCountRes.data || []
  const snapshots = snapshotsRes.data || []

  if (assets.length === 0 && liabilities.length === 0) {
    return NextResponse.json(emptyResponse(currency))
  }

  // Holdings count map
  const holdingsCountByAsset: Record<string, number> = {}
  for (const h of holdings) {
    if (h.asset_id) holdingsCountByAsset[h.asset_id] = (holdingsCountByAsset[h.asset_id] || 0) + 1
  }

  // Group assets
  const assetGroupsMap: Record<string, BalanceSheetAssetGroup> = {}
  let totalAssets = 0
  let accessibleAssets = 0
  for (const a of assets) {
    const value = Number(a.current_value) || 0
    totalAssets += value
    if (a.is_accessible) accessibleAssets += value

    const meta = ASSET_TYPE_META[a.asset_type] || ASSET_TYPE_META.other
    if (!assetGroupsMap[a.asset_type]) {
      assetGroupsMap[a.asset_type] = {
        type: a.asset_type,
        label: meta.label,
        icon: meta.icon,
        color: meta.color,
        total: 0,
        items: [],
      }
    }

    const cost = Number(a.cost_basis)
    const gainLossPct =
      a.cost_basis != null && cost > 0 ? Math.round(((value - cost) / cost) * 1000) / 10 : null

    assetGroupsMap[a.asset_type].total += value
    assetGroupsMap[a.asset_type].items.push({
      id: a.id,
      name: a.name,
      provider: a.provider,
      current_value: Math.round(value * 100) / 100,
      cost_basis: a.cost_basis != null ? Number(a.cost_basis) : null,
      gain_loss_pct: gainLossPct,
      currency: a.currency || currency,
      is_accessible: !!a.is_accessible,
      last_updated: a.last_updated,
      is_stale: isStale(a.last_updated),
      holdings_count: holdingsCountByAsset[a.id] || 0,
    })
  }

  const assetGroups = Object.values(assetGroupsMap)
    .map((g) => ({ ...g, total: Math.round(g.total * 100) / 100 }))
    .sort((a, b) => (ASSET_TYPE_META[a.type]?.order ?? 99) - (ASSET_TYPE_META[b.type]?.order ?? 99))

  // Group liabilities
  const liabilityGroupsMap: Record<string, BalanceSheetLiabilityGroup> = {}
  let totalLiabilities = 0
  for (const l of liabilities) {
    const balance = Number(l.outstanding_balance) || 0
    totalLiabilities += balance

    const meta = LIABILITY_TYPE_META[l.liability_type] || LIABILITY_TYPE_META.other
    if (!liabilityGroupsMap[l.liability_type]) {
      liabilityGroupsMap[l.liability_type] = {
        type: l.liability_type,
        label: meta.label,
        icon: meta.icon,
        color: meta.color,
        total: 0,
        items: [],
      }
    }

    const rate = l.interest_rate != null ? Number(l.interest_rate) : null
    const monthlyInterest = rate != null ? Math.round(((balance * rate) / 100 / 12) * 100) / 100 : null

    liabilityGroupsMap[l.liability_type].total += balance
    liabilityGroupsMap[l.liability_type].items.push({
      id: l.id,
      name: l.name,
      provider: l.provider,
      outstanding_balance: Math.round(balance * 100) / 100,
      interest_rate: rate,
      actual_payment: l.actual_payment != null ? Number(l.actual_payment) : null,
      minimum_payment: l.minimum_payment != null ? Number(l.minimum_payment) : null,
      payment_frequency: l.payment_frequency || 'monthly',
      currency: l.currency || currency,
      is_priority: !!l.is_priority,
      last_updated: l.last_updated,
      is_stale: isStale(l.last_updated),
      monthly_interest: monthlyInterest,
    })
  }

  const liabilityGroups = Object.values(liabilityGroupsMap)
    .map((g) => ({ ...g, total: Math.round(g.total * 100) / 100 }))
    .sort(
      (a, b) =>
        (LIABILITY_TYPE_META[a.type]?.order ?? 99) - (LIABILITY_TYPE_META[b.type]?.order ?? 99)
    )

  const lockedAssets = totalAssets - accessibleAssets
  const netWorth = totalAssets - totalLiabilities

  // Allocation (asset breakdown only — debts are not "allocated to")
  const allocation: AllocationSlice[] = assetGroups
    .filter((g) => g.total > 0)
    .map((g) => ({
      type: g.type,
      label: g.label,
      value: g.total,
      color: g.color,
      pct: totalAssets > 0 ? Math.round((g.total / totalAssets) * 1000) / 10 : 0,
    }))

  // Latest snapshot for delta
  const latest = snapshots[0]
  const netWorthChange = latest?.net_worth_change != null ? Number(latest.net_worth_change) : null
  const netWorthChangePct =
    latest?.net_worth_change_pct != null ? Number(latest.net_worth_change_pct) : null

  // Trend (chronological)
  const trend: TrendPoint[] = snapshots
    .slice()
    .reverse()
    .map((s) => ({
      month: s.month,
      net_worth: Number(s.net_worth) || 0,
      total_assets: Number(s.total_assets) || 0,
      total_liabilities: Number(s.total_liabilities) || 0,
    }))

  // Data gaps
  const dataGaps: DataGap[] = []
  if (!assetGroupsMap.pension) {
    dataGaps.push({
      type: 'pension',
      message: 'No pension information',
      action_label: 'Tell your CFO \u2192',
      action_href: '/chat?topic=pension_setup',
      severity: 'info',
    })
  }
  if (!assetGroupsMap.savings) {
    dataGaps.push({
      type: 'savings',
      message: 'No savings recorded',
      action_label: 'Tell your CFO \u2192',
      action_href: '/chat?topic=savings_setup',
      severity: 'info',
    })
  }
  // Stale data warning if any item is stale
  const anyStale =
    assetGroups.some((g) => g.items.some((i) => i.is_stale)) ||
    liabilityGroups.some((g) => g.items.some((i) => i.is_stale))
  if (anyStale) {
    dataGaps.push({
      type: 'stale',
      message: `Some balances haven\u2019t been updated in over ${STALE_DAYS} days`,
      action_label: 'Update now \u2192',
      action_href: '/chat?topic=balance_sheet_refresh',
      severity: 'warning',
    })
  }

  const response: BalanceSheetResponse = {
    net_worth: Math.round(netWorth * 100) / 100,
    total_assets: Math.round(totalAssets * 100) / 100,
    total_liabilities: Math.round(totalLiabilities * 100) / 100,
    accessible_assets: Math.round(accessibleAssets * 100) / 100,
    locked_assets: Math.round(lockedAssets * 100) / 100,
    net_worth_change: netWorthChange,
    net_worth_change_pct: netWorthChangePct,
    asset_groups: assetGroups,
    liability_groups: liabilityGroups,
    allocation,
    data_gaps: dataGaps,
    trend,
    currency,
    has_data: true,
  }

  return NextResponse.json(response)
}
