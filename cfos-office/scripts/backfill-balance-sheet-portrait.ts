/**
 * Recompute `financial_portrait.asset_profile` traits for every user who has
 * any asset or liability row. Used to repair traits derived under the old
 * `computeTraits` logic that returned `has_property=no` for mortgage-only
 * users, `has_high_interest_debt=no` for credit cards without explicit rates,
 * and `net_worth_bracket=negative` for users with no declared assets.
 *
 * The new logic in src/lib/balance-sheet/portrait.ts is idempotent — running
 * updateAssetPortrait() per user overwrites the existing rows via the
 * `(user_id, trait_key)` unique constraint. No DELETE step needed.
 *
 * USAGE
 *   Run against staging first; companion SQL stub for prod sits at
 *   supabase/prod-backfill-portrait-traits.sql.
 *
 *     npx tsx scripts/backfill-balance-sheet-portrait.ts
 *
 *   Env (via .env.local or shell):
 *     NEXT_PUBLIC_SUPABASE_URL    = https://qlbhvlssksnrhsleadzn.supabase.co  (staging)
 *     SUPABASE_SERVICE_ROLE_KEY   = <service role for that project>
 *
 *   Override the target user set with TARGET_USER_IDS=uuid1,uuid2,... (mostly
 *   useful for spot-checking a single user before running across the fleet).
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { updateAssetPortrait } from '../src/lib/balance-sheet/portrait'

try {
  const envFile = readFileSync(resolve(__dirname, '../.env.local'), 'utf-8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim()
    if (!process.env[key]) process.env[key] = value
  }
} catch {
  /* rely on shell env */
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function gatherTargetUserIds(): Promise<string[]> {
  const override = process.env.TARGET_USER_IDS
  if (override) {
    return override.split(',').map((s) => s.trim()).filter(Boolean)
  }

  const { data: assetUsers, error: aErr } = await supabase
    .from('assets')
    .select('user_id')
    .is('deleted_at', null)
  if (aErr) throw aErr

  const { data: liabUsers, error: lErr } = await supabase
    .from('liabilities')
    .select('user_id')
    .is('deleted_at', null)
  if (lErr) throw lErr

  const ids = new Set<string>()
  for (const row of assetUsers ?? []) ids.add(row.user_id as string)
  for (const row of liabUsers ?? []) ids.add(row.user_id as string)
  return Array.from(ids)
}

async function main() {
  const targets = await gatherTargetUserIds()
  console.log(`[backfill] target users: ${targets.length}`)
  console.log(`[backfill] project: ${supabaseUrl}`)

  let succeeded = 0
  let failed = 0
  for (const userId of targets) {
    try {
      await updateAssetPortrait({ supabase, userId })
      succeeded++
      if (succeeded % 10 === 0) console.log(`[backfill] processed ${succeeded}/${targets.length}`)
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[backfill] user=${userId} failed: ${msg}`)
    }
  }

  console.log(`[backfill] done. succeeded=${succeeded} failed=${failed}`)
  if (failed > 0) process.exit(2)
}

main().catch((err) => {
  console.error('[backfill] fatal:', err)
  process.exit(1)
})
