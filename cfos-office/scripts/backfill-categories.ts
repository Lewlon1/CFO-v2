/**
 * Backfill category_id for transactions where it is null.
 *
 * Dry-run (default) — reports what WOULD change, writes nothing, never calls the LLM:
 *   npx tsx scripts/backfill-categories.ts
 * Apply — runs the rules + LLM passes and writes category_id/confidence:
 *   npx tsx scripts/backfill-categories.ts --apply
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (via .env.local).
 * Points at whatever those env vars target — DO NOT --apply against prod
 * without Lewis's sign-off. The script prints the DB host on startup; confirm it.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { categoriseByRules } from '../src/lib/categorisation/rules-engine'
import { llmCategorise, saveLearnedMerchantRules } from '../src/lib/categorisation/llm-categoriser'
import type {
  Category,
  UserMerchantRule,
  RecurringMatch,
} from '../src/lib/parsers/types'

// Load .env.local manually
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
  // rely on env
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Dry-run by default; only --apply writes to the DB and calls the LLM.
const APPLY = process.argv.includes('--apply')

type Txn = {
  id: string
  user_id: string
  description: string
  amount: number
}

async function run() {
  const host = (() => { try { return new URL(supabaseUrl).host } catch { return supabaseUrl } })()
  console.log(`\n${APPLY ? '🔴 APPLY' : '🟢 DRY-RUN'} — target DB: ${host}`)
  if (!APPLY) console.log('(no writes, no LLM calls — pass --apply to execute)')

  const { data: categories, error: catErr } = await supabase
    .from('categories')
    .select('*')
  if (catErr || !categories) throw catErr ?? new Error('No categories')

  const { data: txns, error: txnErr } = await supabase
    .from('transactions')
    .select('id,user_id,description,amount')
    .is('category_id', null)
    .is('deleted_at', null)
  if (txnErr) throw txnErr

  const stats = {
    total: txns?.length ?? 0,
    byRules: 0,
    byLLM: 0,
    wouldGoToLLM: 0,
    stillNull: 0,
    errors: 0,
  }
  const byCat: Record<string, number> = {}

  if (!txns || txns.length === 0) {
    console.log('Nothing to backfill.')
    console.log(stats)
    return
  }

  // Group by user_id
  const byUser = new Map<string, Txn[]>()
  for (const t of txns as Txn[]) {
    const bucket = byUser.get(t.user_id) ?? []
    bucket.push(t)
    byUser.set(t.user_id, bucket)
  }

  for (const [userId, userTxns] of byUser) {
    console.log(`\nUser ${userId}: ${userTxns.length} uncategorised`)

    const { data: userRules } = await supabase
      .from('user_merchant_rules')
      .select('*')
      .eq('user_id', userId)
    const { data: recurring } = await supabase
      .from('recurring_expenses')
      .select('id,name,category_id')
      .eq('user_id', userId)

    const context = {
      categories: categories as Category[],
      userMerchantRules: (userRules ?? []) as UserMerchantRule[],
      recurringExpenses: (recurring ?? []) as RecurringMatch[],
    }

    const stillNeedLLM: Array<{ id: string; description: string }> = []

    // Pass 1: rules engine
    for (const t of userTxns) {
      const result = categoriseByRules(t.description, { ...context, amount: t.amount })
      if (result.categoryId) {
        byCat[result.categoryId] = (byCat[result.categoryId] ?? 0) + 1
        if (!APPLY) {
          stats.byRules++
          continue
        }
        const { error } = await supabase
          .from('transactions')
          .update({
            category_id: result.categoryId,
            auto_category_confidence: result.confidence,
          })
          .eq('id', t.id)
        if (error) {
          stats.errors++
          console.error(`  [rules update fail] ${t.id}`, error.message)
        } else {
          stats.byRules++
        }
      } else {
        stillNeedLLM.push({ id: t.id, description: t.description })
      }
    }

    // Dry-run stops here: report how many would go to the LLM, don't call it.
    if (!APPLY) {
      stats.wouldGoToLLM += stillNeedLLM.length
      continue
    }

    // Pass 2: LLM in batches of 50
    for (let i = 0; i < stillNeedLLM.length; i += 50) {
      const batch = stillNeedLLM.slice(i, i + 50)
      const descriptions = batch.map((b) => b.description)
      const results = await llmCategorise(descriptions, categories as Category[], userId)

      await saveLearnedMerchantRules(supabase, userId, descriptions, results)

      for (const r of results) {
        const target = batch[r.index - 1]
        if (!target) continue
        const { error } = await supabase
          .from('transactions')
          .update({
            category_id: r.category_id,
            auto_category_confidence: r.confidence,
          })
          .eq('id', target.id)
        if (error) {
          stats.errors++
          console.error(`  [llm update fail] ${target.id}`, error.message)
        } else {
          stats.byLLM++
        }
      }

      const matchedIndices = new Set(results.map((r) => r.index))
      for (let idx = 1; idx <= batch.length; idx++) {
        if (!matchedIndices.has(idx)) stats.stillNull++
      }
    }
  }

  console.log(`\n=== Backfill ${APPLY ? 'complete' : 'dry-run'} ===`)
  console.log(stats)

  console.log('\n-- would-be matches by category --')
  for (const [cat, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(20)} ${n}`)
  }

  const { count: totalCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)
  const { count: categorisedCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .not('category_id', 'is', null)
    .is('deleted_at', null)

  if (totalCount && categorisedCount !== null) {
    const pct = ((categorisedCount! / totalCount) * 100).toFixed(1)
    console.log(`\nCurrent coverage: ${categorisedCount}/${totalCount} (${pct}%)`)
    if (!APPLY) {
      const projected = categorisedCount! + stats.byRules
      const projPct = ((projected / totalCount) * 100).toFixed(1)
      console.log(`Projected after rules backfill: ${projected}/${totalCount} (${projPct}%), plus up to ${stats.wouldGoToLLM} more via the LLM pass`)
    }
  }
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
