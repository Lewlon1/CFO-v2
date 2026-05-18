#!/usr/bin/env tsx
/**
 * Usage: npx tsx scripts/show-shape-and-posture.ts <userId>
 *
 * Prints the persisted income shape + financial posture from user_profiles
 * and recomputes both live for side-by-side comparison.
 *
 * Prerequisites:
 * - .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 * - The target user must exist in the target Supabase project
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

// --- 1. Load .env.local manually (avoids dotenv dependency) ---
const ENV_CANDIDATES = [
  resolve(__dirname, '../.env.local'),
  resolve(__dirname, '../../.env.local'),
  resolve(__dirname, '../../cfos-office/.env.local'),
  resolve(__dirname, '../../../cfos-office/.env.local'),
  resolve(__dirname, '../../../../cfos-office/.env.local'),
  resolve(__dirname, '../../../../../cfos-office/.env.local'),
]

let envLoadedFrom: string | null = null
for (const candidate of ENV_CANDIDATES) {
  try {
    const envFile = readFileSync(candidate, 'utf-8')
    for (const line of envFile.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const value = trimmed.slice(eqIdx + 1).trim()
      if (!process.env[key]) process.env[key] = value
    }
    envLoadedFrom = candidate
    break
  } catch {
    // try next candidate
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env')
  console.error(
    envLoadedFrom
      ? `Loaded env from: ${envLoadedFrom} (but required keys missing)`
      : `No .env.local found. Tried: ${ENV_CANDIDATES.join(', ')}`,
  )
  process.exit(1)
}

import { createClient } from '@supabase/supabase-js'
import { detectIncomeShape } from '../src/lib/analytics/income-shape'
import { computeCashFlowAggregates } from '../src/lib/analytics/cashflow-aggregates'
import { detectPosture } from '../src/lib/analytics/posture'

const userId = process.argv[2]
if (!userId) {
  console.error('Usage: npx tsx scripts/show-shape-and-posture.ts <userId>')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function fmt(v: number | string | null | undefined): string {
  return v === null || v === undefined ? 'NULL' : String(v)
}

async function main() {
  const { data: profile, error: pErr } = await supabase
    .from('user_profiles')
    .select(
      'income_shape, income_volatility, income_shape_deposit_count, income_shape_detected_at, financial_posture, posture_confidence, runway_days, t3m_income_monthly, t3m_spend_monthly, balance_trajectory, posture_detected_at',
    )
    .eq('id', userId)
    .single()

  if (pErr) {
    console.error('Failed to load profile:', pErr)
    process.exit(1)
  }

  console.log('\n── Persisted (user_profiles) ──')
  console.log(`income_shape:                  ${fmt(profile.income_shape)}`)
  console.log(`income_volatility:             ${fmt(profile.income_volatility)}`)
  console.log(`income_shape_deposit_count:    ${fmt(profile.income_shape_deposit_count)}`)
  console.log(`income_shape_detected_at:      ${fmt(profile.income_shape_detected_at)}`)
  console.log(`financial_posture:             ${fmt(profile.financial_posture)}`)
  console.log(`posture_confidence:            ${fmt(profile.posture_confidence)}`)
  console.log(`runway_days:                   ${fmt(profile.runway_days)}`)
  console.log(`t3m_income_monthly:            ${fmt(profile.t3m_income_monthly)}`)
  console.log(`t3m_spend_monthly:             ${fmt(profile.t3m_spend_monthly)}`)
  console.log(`balance_trajectory:            ${fmt(profile.balance_trajectory)}`)
  console.log(`posture_detected_at:           ${fmt(profile.posture_detected_at)}`)

  // ─── Live shape recomputation ─────────────────────────────────────────
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 12)
  const { data: txns } = await supabase
    .from('transactions')
    .select('amount, category_id, date')
    .eq('user_id', userId)
    .gte('date', cutoff.toISOString().slice(0, 10))

  const liveShape = detectIncomeShape(txns ?? [])

  // ─── Live posture recomputation ───────────────────────────────────────
  const { data: accounts } = await supabase
    .from('accounts')
    .select('current_balance, type')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .neq('type', 'credit_card')

  const hasAccounts = !!accounts && accounts.length > 0
  const liquidSum = hasAccounts
    ? accounts!
        .filter((a) => a.current_balance !== null)
        .reduce((s, a) => s + Number(a.current_balance), 0)
    : 0
  const liquidBalance = hasAccounts && Number.isFinite(liquidSum) ? liquidSum : null

  const { data: snapshots } = await supabase
    .from('monthly_snapshots')
    .select('month, total_income, total_spending, closing_balance')
    .eq('user_id', userId)
    .order('month', { ascending: false })
    .limit(3)

  const liveAggregates = computeCashFlowAggregates(
    (snapshots ?? []).map((s) => ({
      month: typeof s.month === 'string' ? s.month : String(s.month),
      income_total: Number(s.total_income) || 0,
      spend_total: Number(s.total_spending) || 0,
      closing_balance:
        s.closing_balance === null || s.closing_balance === undefined
          ? null
          : Number(s.closing_balance),
    })),
    liquidBalance,
  )

  const livePosture = detectPosture(liveShape.shape, liveAggregates)

  console.log('\n── Live recomputation ──')
  console.log(`shape:                         ${liveShape.shape}`)
  console.log(`volatility:                    ${fmt(liveShape.volatility)}`)
  console.log(`deposit_count:                 ${liveShape.deposit_count}`)
  console.log(`liquid_balance:                ${fmt(liquidBalance)}`)
  console.log(`t3m_income_monthly:            ${fmt(liveAggregates.t3m_income_monthly)}`)
  console.log(`t3m_spend_monthly:             ${fmt(liveAggregates.t3m_spend_monthly)}`)
  console.log(`runway_days:                   ${fmt(liveAggregates.runway_days)}`)
  console.log(`balance_trajectory:            ${liveAggregates.balance_trajectory}`)
  console.log(`months_observed:               ${liveAggregates.months_observed}`)
  console.log(`posture:                       ${livePosture.posture}`)
  console.log(`posture_confidence:            ${livePosture.confidence}`)

  // ─── Divergence report ────────────────────────────────────────────────
  const divergences: string[] = []
  if (liveShape.shape !== profile.income_shape) {
    divergences.push(`shape: live=${liveShape.shape} vs persisted=${profile.income_shape}`)
  }
  if (Number(liveShape.volatility) !== Number(profile.income_volatility)) {
    divergences.push(
      `volatility: live=${liveShape.volatility} vs persisted=${profile.income_volatility}`,
    )
  }
  if (livePosture.posture !== profile.financial_posture) {
    divergences.push(
      `posture: live=${livePosture.posture} vs persisted=${profile.financial_posture}`,
    )
  }
  if (Number(liveAggregates.runway_days) !== Number(profile.runway_days)) {
    divergences.push(
      `runway: live=${liveAggregates.runway_days} vs persisted=${profile.runway_days}`,
    )
  }

  if (divergences.length > 0) {
    console.log('\n⚠️  Persisted and live values disagree — refresh may be stale:')
    for (const d of divergences) console.log(`  - ${d}`)
  } else {
    console.log('\n✓ Persisted and live values match.')
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
