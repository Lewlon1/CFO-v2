import type { SupabaseClient } from '@supabase/supabase-js'
import type { Persona } from '../personas/types'
import type { DbStateSnapshot } from './types'

export async function snapshotDbState(admin: SupabaseClient, userId: string): Promise<DbStateSnapshot> {
  const [profileRes, portraitRes, progressRes, estimatesRes, txnRes, msgRes, recurringRes, goalsRes] =
    await Promise.all([
      admin.from('user_profiles').select('*').eq('id', userId).maybeSingle(),
      admin.from('financial_portrait').select('*').eq('user_id', userId),
      admin.from('onboarding_progress').select('*').eq('user_id', userId).maybeSingle(),
      admin.from('onboarding_estimates').select('*').eq('user_id', userId).maybeSingle(),
      admin.from('transactions').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      admin.from('messages').select('content').eq('user_id', userId).eq('role', 'assistant'),
      admin.from('recurring_expenses').select('name').eq('user_id', userId),
      admin.from('goals').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    ])

  return {
    user_profiles: profileRes.data ?? null,
    financial_portrait: portraitRes.data ?? null,
    onboarding_progress: progressRes.data ?? null,
    onboarding_estimates: estimatesRes.data ?? null,
    transactionCount: txnRes.count ?? 0,
    assistantMessageContents: (msgRes.data ?? []).map((m) => String((m as { content?: unknown }).content ?? '')),
    recurringNames: (recurringRes.data ?? []).map((r) => String((r as { name?: unknown }).name ?? '')),
    goalsCount: goalsRes.count ?? 0,
  }
}

// ── Flow-agnostic fix invariants (run for every persona) ─────────────────────

/**
 * Fix #2 — the internal QA "(System note: …)" diagnostic must never reach a
 * persisted / user-visible assistant message. Catches both the appended
 * first-person form and any model-echoed passive form. See `stripValidatorNote`
 * + `showInternalQANotes` (default-off).
 */
export function assertNoValidatorNoteLeak(contents: string[]): string[] {
  const n = contents.filter((c) => /\(System note:/i.test(c)).length
  return n > 0
    ? [`messages: ${n} assistant message(s) contain a leaked "(System note: …)" QA diagnostic`]
    : []
}

/**
 * Fix #3 — recurring_expenses must not carry case-variant duplicates
 * ("Supabase" + "supabase"); they double-inflate fixed costs.
 */
export function assertNoCaseDupRecurringNames(names: string[]): string[] {
  const byKey = new Map<string, string[]>()
  for (const name of names) {
    const key = name.trim().toLowerCase()
    if (!key) continue
    byKey.set(key, [...(byKey.get(key) ?? []), name])
  }
  const dups = [...byKey.values()].filter((g) => g.length > 1)
  return dups.length > 0
    ? [`recurring_expenses: case-variant duplicate name(s): ${dups.map((g) => g.join(' / ')).join('; ')}`]
    : []
}

// ── onboarding_estimates verification invariant (check personas) ─────────────

interface VerificationBand {
  state?: string
}
interface VerificationJson {
  engine_version?: string
  bands?: Record<string, VerificationBand>
}

/**
 * A statement-check persona's onboarding_estimates.verification must be populated
 * by the reality-check route: engine_version 'v1' and at least one band whose
 * actual was found (state 'verified'). Mirrors toVerificationJson in
 * src/lib/onboarding-v2/estimates/deltas.ts.
 */
export function assertVerificationPopulated(estimates: Record<string, unknown> | null): string[] {
  const verification = (estimates?.verification ?? null) as VerificationJson | null
  if (!verification || Object.keys(verification).length === 0) {
    return ['onboarding_estimates.verification: expected populated, got empty']
  }
  const errors: string[] = []
  if (verification.engine_version !== 'v1') {
    errors.push(
      `onboarding_estimates.verification.engine_version: expected 'v1', got ${JSON.stringify(verification.engine_version)}`,
    )
  }
  const verifiedCount = Object.values(verification.bands ?? {}).filter((b) => b?.state === 'verified').length
  if (verifiedCount < 1) {
    errors.push(`onboarding_estimates.verification: expected ≥1 verified band, got ${verifiedCount}`)
  }
  return errors
}

const BAND_COLUMNS = ['housing_band', 'subs_band', 'bills_band', 'food_out_band', 'save_reach_band'] as const
const VERDICT_KEYS = ['subscriptions', 'food_out', 'drift'] as const

export function assertDbState(persona: Persona, snapshot: DbStateSnapshot): string[] {
  const errors: string[] = []
  const expected = persona.expectations.dbAfterHandoff
  const isCheck = persona.expectations.runStatementCheck
  const prof = (snapshot.user_profiles ?? {}) as Record<string, unknown>

  // ── Terminal onboarding state ──────────────────────────────────────────────
  // The estimate Read stamps onboarding_completed_at (the completion gate) for
  // every persona; the one-way ratchet never clears it.
  if (prof.onboarding_completed_at == null) {
    errors.push('user_profiles.onboarding_completed_at: expected not-null, got null')
  }
  // Non-check personas terminate on first_read_delivered (the estimate Read);
  // check personas walk on to reality_check_delivered.
  const expectedStep = isCheck ? 'reality_check_delivered' : 'first_read_delivered'
  if (prof.onboarding_step !== expectedStep) {
    errors.push(
      `user_profiles.onboarding_step: expected ${expectedStep}, got ${JSON.stringify(prof.onboarding_step)}`,
    )
  }

  // Any persona-declared user_profiles overrides (beyond the terminal invariants).
  if (expected.user_profiles) {
    for (const [key, want] of Object.entries(expected.user_profiles)) {
      const got = prof[key]
      if (want === 'not-null') {
        if (got == null) errors.push(`user_profiles.${key}: expected not-null, got null`)
      } else if (got !== want) {
        errors.push(`user_profiles.${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
      }
    }
  }

  // ── onboarding_estimates: the sketch the Read was built from ────────────────
  const est = snapshot.onboarding_estimates
  if (!est) {
    errors.push('onboarding_estimates: expected a row, got none')
  } else {
    const missingBands = BAND_COLUMNS.filter((c) => est[c] == null)
    if (missingBands.length) {
      errors.push(`onboarding_estimates: missing band(s): ${missingBands.join(', ')}`)
    }
    if (est.income_monthly == null) {
      errors.push('onboarding_estimates.income_monthly: expected not-null')
    }
    if (est.top_value == null) {
      errors.push('onboarding_estimates.top_value: expected not-null')
    }
    const verdicts = (est.verdicts ?? {}) as Record<string, unknown>
    const missingV = VERDICT_KEYS.filter((k) => verdicts[k] == null)
    if (missingV.length) {
      errors.push(`onboarding_estimates.verdicts: missing ${missingV.join(', ')}`)
    }
    // Check personas: the reality-check route must have written verification.
    if (isCheck) {
      errors.push(...assertVerificationPopulated(est))
    }
  }

  // ── Goal persistence — the estimate goal beat creates exactly one ──────────
  if (snapshot.goalsCount < 1) {
    errors.push(`goals: expected ≥1 row (the goal beat creates one), got ${snapshot.goalsCount}`)
  }

  // ── Transactions ────────────────────────────────────────────────────────
  // Non-check personas never upload, so they hold zero transactions; check
  // personas import their statement (use the persona's countBetween, else ≥1).
  if (isCheck) {
    const range = expected.transactions?.countBetween
    if (range) {
      const [min, max] = range
      if (snapshot.transactionCount < min || snapshot.transactionCount > max) {
        errors.push(`transactions.count: expected between ${min}-${max}, got ${snapshot.transactionCount}`)
      }
    } else if (snapshot.transactionCount < 1) {
      errors.push(`transactions.count: expected ≥1 after the statement-check import, got ${snapshot.transactionCount}`)
    }
  } else if (snapshot.transactionCount !== 0) {
    errors.push(`transactions.count: expected 0 for a non-check persona (no upload), got ${snapshot.transactionCount}`)
  }

  // ── Universal fix invariants — apply to every persona ──────────────────────
  errors.push(...assertNoValidatorNoteLeak(snapshot.assistantMessageContents))
  errors.push(...assertNoCaseDupRecurringNames(snapshot.recurringNames))

  return errors
}
