import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { loadUserRules } from '@/lib/prediction/predictor'
import { refreshMonthlySnapshots } from '@/lib/analytics/monthly-snapshot'
import type { ValueCategoryRule } from '@/lib/parsers/types'
import { normaliseMerchant } from './normalise-merchant'
import {
  matchValueRule,
  RULE_MATCH_PREDICTION_SOURCE,
} from './value-rule-matcher'

/**
 * VM-2 — retroactive rule application.
 *
 * Rules used to apply only at ingest: a rule learned on Tuesday never reached
 * the six months of history imported on Monday. This module re-applies the
 * current rule set to a user's existing transactions, through the same shared
 * matcher (and therefore the same merchant normalisation) the ingest path uses.
 *
 * Invariants:
 * - SACRED: rows with value_confirmed_by_user = true are never modified.
 *   Precedence is absolute: user_confirmed > merchant_rule > category_default.
 * - Re-score only ever writes from a RULE match. It never "applies" a
 *   category-default downgrade — a row no rule speaks to keeps its label.
 * - Rules MAY emit 'leak': rules are user evidence, unlike category defaults.
 * - Idempotent: a second run over unchanged data updates zero rows (modulo
 *   recency-boost decay across days, which only nudges value_confidence).
 */

export interface RescoreResult {
  scanned: number
  updated: number
  /** updates per winning value_category_rules.id ('unknown' if the rule row carried no id) */
  byRule: Record<string, number>
  /** YYYY-MM months containing at least one updated transaction */
  affectedMonths: string[]
}

/** The transaction shape the planner needs — mirrors the re-score SELECT. */
export interface RescoreTxn {
  id: string
  description: string
  category_id: string | null
  amount: number
  date: string
  value_category: string | null
  value_confidence: number | string | null
  value_confirmed_by_user: boolean | null
  prediction_source: string | null
}

export interface PlannedUpdate {
  id: string
  month: string // YYYY-MM
  ruleId: string
  value_category: string
  value_confidence: number
  prediction_source: string
}

/**
 * Pure planning core — no I/O. Decides which transactions a re-score would
 * update and to what. Exported for unit tests; rescoreValueCategories wraps it.
 *
 * `scopeRuleIds` narrows which transactions are CONSIDERED (only those a
 * just-written rule could speak to), but resolution always runs against the
 * FULL rule set so a more specific competing rule still wins.
 */
export function planRescore(
  txns: RescoreTxn[],
  rules: ValueCategoryRule[],
  scopeRuleIds?: string[]
): { scanned: number; updates: PlannedUpdate[] } {
  const scoped = scopeRuleIds
    ? rules.filter((r) => r.id && scopeRuleIds.includes(r.id))
    : rules
  if (rules.length === 0 || scoped.length === 0) return { scanned: 0, updates: [] }

  const scopeMerchants = new Set<string>()
  const scopeCategories = new Set<string>()
  let scopeHasGlobal = false
  for (const r of scoped) {
    if (r.match_type === 'global') scopeHasGlobal = true
    else if (r.match_type.startsWith('merchant')) scopeMerchants.add(r.match_value)
    else scopeCategories.add(r.match_value)
  }

  let scanned = 0
  const updates: PlannedUpdate[] = []

  for (const txn of txns) {
    // Sacred rule — never touch user-confirmed rows, however they're flagged.
    if (txn.value_confirmed_by_user) continue
    if (txn.prediction_source === 'user_confirmed') continue

    const merchantClean = normaliseMerchant(txn.description)

    // Scope filter: skip transactions none of the just-written rules target.
    if (
      !scopeHasGlobal &&
      !scopeMerchants.has(merchantClean) &&
      !(txn.category_id && scopeCategories.has(txn.category_id))
    ) {
      continue
    }
    scanned++

    const match = matchValueRule(
      {
        description: txn.description,
        merchantClean,
        categoryId: txn.category_id,
        amount: Number(txn.amount),
        date: txn.date,
      },
      rules
    )
    if (!match) continue

    const newSource = RULE_MATCH_PREDICTION_SOURCE[match.matchType]
    const currentConfidence =
      txn.value_confidence === null ? null : Number(txn.value_confidence)

    if (
      txn.value_category === match.valueCategory &&
      currentConfidence === match.confidence &&
      txn.prediction_source === newSource
    ) {
      continue // already correct — idempotency
    }

    updates.push({
      id: txn.id,
      month: String(txn.date).slice(0, 7),
      ruleId: match.ruleId ?? 'unknown',
      value_category: match.valueCategory,
      value_confidence: match.confidence,
      prediction_source: newSource,
    })
  }

  return { scanned, updates }
}

const PAGE_SIZE = 1000

/**
 * Re-applies current rules to a user's historical transactions.
 * Idempotent. Skips user_confirmed. Downgrade-safe: a rule may overwrite
 * category_default or an older merchant_rule, never user_confirmed.
 * `opts.ruleIds` limits scope (used by rule-write hooks); absent = full
 * re-score (VM-3 calls this after a Value Map session).
 *
 * Affected monthly snapshots are recomputed via the existing
 * refreshMonthlySnapshots before returning.
 */
export async function rescoreValueCategories(
  userId: string,
  opts?: { ruleIds?: string[]; supabase?: SupabaseClient }
): Promise<RescoreResult> {
  const supabase = opts?.supabase ?? createServiceClient()
  const result: RescoreResult = { scanned: 0, updated: 0, byRule: {}, affectedMonths: [] }

  const rules = await loadUserRules(supabase, userId)
  if (rules.length === 0) return result

  // Page through the user's live, unconfirmed transactions.
  const txns: RescoreTxn[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('transactions')
      .select(
        'id, description, category_id, amount, date, value_category, value_confidence, value_confirmed_by_user, prediction_source'
      )
      .eq('user_id', userId)
      .is('deleted_at', null)
      .eq('value_confirmed_by_user', false)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      console.error('[value-rescore] transaction page load failed:', error)
      return result
    }
    txns.push(...((data ?? []) as RescoreTxn[]))
    if (!data || data.length < PAGE_SIZE) break
  }

  const { scanned, updates } = planRescore(txns, rules, opts?.ruleIds)
  result.scanned = scanned

  const months = new Set<string>()
  for (const u of updates) {
    const { error } = await supabase
      .from('transactions')
      .update({
        value_category: u.value_category,
        value_confidence: u.value_confidence,
        prediction_source: u.prediction_source,
      })
      .eq('id', u.id)
      .eq('user_id', userId)
      .eq('value_confirmed_by_user', false) // sacred-rule guard, re-checked at write time

    if (error) {
      console.error('[value-rescore] update failed:', { id: u.id, error })
      continue
    }
    result.updated++
    result.byRule[u.ruleId] = (result.byRule[u.ruleId] ?? 0) + 1
    months.add(u.month)
  }
  result.affectedMonths = [...months].sort()

  if (result.affectedMonths.length > 0) {
    try {
      await refreshMonthlySnapshots(supabase, userId, result.affectedMonths)
    } catch (err) {
      console.error('[value-rescore] snapshot refresh failed:', err)
    }
  }

  return result
}
