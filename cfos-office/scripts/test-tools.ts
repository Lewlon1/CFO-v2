#!/usr/bin/env tsx
/**
 * Usage: CHAT_INTELLIGENCE_V2_FORCE=1 npx tsx scripts/test-tools.ts <userId>
 *
 * Invokes each of the Phase 2 Chat Intelligence tools against a real user
 * (typically User Lew 1, bcfbb511-9b0e-4c13-b566-1ef5b0829fa0) and dumps
 * each tool's JSON output. Used for sanity-checking that tools return
 * reasonable shapes against real staging data before Phase 4 swaps the
 * prompt to call them.
 *
 * Prerequisites:
 * - .env.local (or env vars) with NEXT_PUBLIC_SUPABASE_URL and
 *   SUPABASE_SERVICE_ROLE_KEY pointed at CFO Staging (qlbhvlssksnrhsleadzn).
 * - The target user must exist and have transactions.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// --- 1. Load .env.local ---------------------------------------------------
const ENV_CANDIDATES = [
  resolve(__dirname, '../.env.local'),
  resolve(__dirname, '../../.env.local'),
  resolve(__dirname, '../../cfos-office/.env.local'),
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

if (!envLoadedFrom) {
  console.error('Could not locate .env.local. Tried:')
  ENV_CANDIDATES.forEach((c) => console.error(`  ${c}`))
  process.exit(1)
}

// --- 2. Parse args + build ctx -------------------------------------------
const userId = process.argv[2]
if (!userId) {
  console.error('Usage: npx tsx scripts/test-tools.ts <userId>')
  process.exit(1)
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// --- 3. Load tool factories ----------------------------------------------
import { createGetTransactionsTool } from '../src/lib/ai/tools/get-transactions'
import { createGetTopMerchantsTool } from '../src/lib/ai/tools/get-top-merchants'
import { createFindMoneyClustersTool } from '../src/lib/ai/tools/find-money-clusters'
import { createFindTemporalSignalsTool } from '../src/lib/ai/tools/find-temporal-signals'
import { createFindTrendChangesTool } from '../src/lib/ai/tools/find-trend-changes'
import { createFindOutliersTool } from '../src/lib/ai/tools/find-outliers'
import { createProposeExperimentTool } from '../src/lib/ai/tools/propose-experiment'
import { createLabelTransactionsTool } from '../src/lib/ai/tools/label-transactions'

// --- 4. Build a date window -----------------------------------------------
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
const today = new Date()
const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000)

const DATE_FROM_30 = isoDate(thirtyDaysAgo)
const DATE_FROM_90 = isoDate(ninetyDaysAgo)
const DATE_TO = isoDate(today)

const ctx = {
  supabase: supabase as any,
  userId,
  conversationId: 'test-tools-script',
  currency: 'EUR',
}

// --- 5. Invoke each tool -------------------------------------------------
async function run() {
  console.log(`# test-tools.ts — userId=${userId}`)
  console.log(`# env loaded from ${envLoadedFrom}`)
  console.log(`# window: ${DATE_FROM_30} → ${DATE_TO} (30d) / ${DATE_FROM_90} → ${DATE_TO} (90d)\n`)

  const tools: Array<{ name: string; input: any; tool: any }> = [
    {
      name: 'get_transactions',
      tool: createGetTransactionsTool(ctx),
      input: { date_from: DATE_FROM_30, date_to: DATE_TO, limit: 10, sort: 'date_desc', direction: 'spend' },
    },
    {
      name: 'get_top_merchants',
      tool: createGetTopMerchantsTool(ctx),
      input: { date_from: DATE_FROM_30, date_to: DATE_TO, limit: 5 },
    },
    {
      name: 'find_money_clusters',
      tool: createFindMoneyClustersTool(ctx),
      input: { date_from: DATE_FROM_90, date_to: DATE_TO },
    },
    {
      name: 'find_temporal_signals',
      tool: createFindTemporalSignalsTool(ctx),
      input: { date_from: DATE_FROM_90, date_to: DATE_TO },
    },
    {
      name: 'find_trend_changes',
      tool: createFindTrendChangesTool(ctx),
      input: { date_to: DATE_TO },
    },
    {
      name: 'find_outliers',
      tool: createFindOutliersTool(ctx),
      input: { date_from: DATE_FROM_30, date_to: DATE_TO },
    },
    // propose_experiment is skipped here because it writes a row to
    // proposed_experiments — invoke manually when you actually want a row.
    // label_transactions is skipped because it requires real transaction IDs
    // we'd have to look up first; invoke manually for a real test.
  ]

  for (const { name, input, tool } of tools) {
    console.log(`\n=== ${name} ===`)
    console.log('input:', JSON.stringify(input))
    try {
      const result = await tool.execute(input)
      console.log('output:', JSON.stringify(result, null, 2))
    } catch (err: any) {
      console.error(`ERROR in ${name}:`, err?.message ?? err)
    }
  }
}

run().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
