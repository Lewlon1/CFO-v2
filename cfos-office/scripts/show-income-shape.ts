#!/usr/bin/env tsx
/**
 * Usage: npx tsx scripts/show-income-shape.ts <userId>
 *
 * Prints the persisted income shape from user_profiles and recomputes it
 * live from transactions for side-by-side comparison.
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

const userId = process.argv[2]
if (!userId) {
  console.error('Usage: npx tsx scripts/show-income-shape.ts <userId>')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main() {
  const { data: profile, error: pErr } = await supabase
    .from('user_profiles')
    .select(
      'income_shape, income_volatility, income_shape_deposit_count, income_shape_detected_at',
    )
    .eq('id', userId)
    .single()

  if (pErr) {
    console.error('Failed to load profile:', pErr)
    process.exit(1)
  }

  console.log('\n── Persisted (user_profiles) ──')
  console.log(`income_shape:                  ${profile.income_shape ?? 'NULL'}`)
  console.log(`income_volatility:             ${profile.income_volatility ?? 'NULL'}`)
  console.log(`income_shape_deposit_count:    ${profile.income_shape_deposit_count ?? 'NULL'}`)
  console.log(`income_shape_detected_at:      ${profile.income_shape_detected_at ?? 'NULL'}`)

  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 12)
  const { data: txns } = await supabase
    .from('transactions')
    .select('amount, category_id, date')
    .eq('user_id', userId)
    .gte('date', cutoff.toISOString().slice(0, 10))

  const live = detectIncomeShape(txns ?? [])
  console.log('\n── Live recomputation ──')
  console.log(`shape:                         ${live.shape}`)
  console.log(`volatility:                    ${live.volatility ?? 'NULL'}`)
  console.log(`deposit_count:                 ${live.deposit_count}`)

  if (
    live.shape !== profile.income_shape ||
    Number(live.volatility) !== Number(profile.income_volatility)
  ) {
    console.log('\n⚠️  Persisted and live values disagree — refresh may be stale.')
  } else {
    console.log('\n✓ Persisted and live values match.')
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
