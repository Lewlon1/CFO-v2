/**
 * Seed the filing cabinet's `patterns` digests for users who already have a
 * financial portrait.
 *
 * The digests are maintained going forward by the hooks in
 * `src/lib/memory/digests.ts` — they fire whenever a trait is written or
 * dismissed. But an existing user's traits were written long before those hooks
 * existed, so without this their folders open empty on the day the feature
 * ships, and the CFO reads nothing about a person it has known for months.
 *
 * Deterministic and free: no LLM call, no arithmetic — the digest is a render of
 * rows that already exist.
 *
 * USAGE
 *   Read-only by default. It prints what it WOULD file and writes nothing:
 *
 *     npx tsx scripts/backfill-memory-digests.ts
 *
 *   To actually write (staging first, then prod once reviewed):
 *
 *     APPLY=1 npx tsx scripts/backfill-memory-digests.ts
 *
 *   Env (via .env.local or shell):
 *     NEXT_PUBLIC_SUPABASE_URL   = https://qlbhvlssksnrhsleadzn.supabase.co  (staging)
 *     SUPABASE_SERVICE_ROLE_KEY  = <service role for that project>
 *     TARGET_USER_IDS            = optional comma-separated list; default is every
 *                                  user with at least one non-dismissed trait
 *
 *   Safe to re-run. A digest whose render is unchanged is not rewritten, and a
 *   digest the user has edited is never rewritten at all — the backfill goes
 *   through the same `refreshMemoryDigests` the live hooks use, so it inherits
 *   every rule those follow.
 *
 *   NOTE: this writes with the SERVICE key, which bypasses RLS. Every call is
 *   scoped to one user id, which is why the loop passes them one at a time.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { refreshMemoryDigests, renderDigest, type PortraitTrait } from '../src/lib/memory/digests'
import { MEMORY_FOLDERS } from '../src/lib/memory/constants'

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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const APPLY = process.env.APPLY === '1'

async function main() {
  const supabase = createClient(supabaseUrl, serviceKey)

  const targets = process.env.TARGET_USER_IDS?.split(',').map((s) => s.trim()).filter(Boolean)

  let userIds: string[]
  if (targets && targets.length > 0) {
    userIds = targets
  } else {
    const { data, error } = await supabase
      .from('financial_portrait')
      .select('user_id')
      .is('dismissed_at', null)

    if (error) {
      console.error('[backfill] could not list users:', error)
      process.exit(1)
    }
    userIds = Array.from(new Set((data ?? []).map((r) => r.user_id as string)))
  }

  console.log(`${APPLY ? 'Filing' : 'DRY RUN — would file'} digests for ${userIds.length} user(s).`)
  console.log(`Target: ${supabaseUrl}`)
  console.log('')

  let filed = 0
  for (const userId of userIds) {
    const { data, error } = await supabase
      .from('financial_portrait')
      .select('trait_type, trait_key, trait_value, confidence, updated_at, created_at')
      .eq('user_id', userId)
      .is('dismissed_at', null)

    if (error) {
      console.error(`[backfill] ${userId}: portrait read failed:`, error)
      continue
    }

    const traits = (data ?? []) as unknown as PortraitTrait[]
    const summary = MEMORY_FOLDERS.map((folder) => {
      const body = renderDigest(folder, traits)
      return body ? `${folder}(${body.split('\n').filter((l) => l.startsWith('- ')).length})` : null
    }).filter(Boolean)

    if (summary.length === 0) {
      console.log(`${userId}: nothing to file (${traits.length} trait(s), none eligible)`)
      continue
    }

    console.log(`${userId}: ${summary.join(' ')}`)
    if (APPLY) {
      await refreshMemoryDigests(supabase, userId)
      filed++
    }
  }

  console.log('')
  if (APPLY) {
    console.log(`Done. ${filed} user(s) refreshed.`)
  } else {
    console.log('Dry run only — nothing written. Re-run with APPLY=1 to file.')
  }
}

main().catch((err) => {
  console.error('[backfill] fatal:', err)
  process.exit(1)
})
