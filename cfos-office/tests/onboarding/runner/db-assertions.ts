import type { SupabaseClient } from '@supabase/supabase-js'
import type { Persona } from '../personas/types'
import type { DbStateSnapshot } from './types'

export async function snapshotDbState(admin: SupabaseClient, userId: string): Promise<DbStateSnapshot> {
  const [profileRes, portraitRes, progressRes, txnRes, msgRes, recurringRes, goalsRes] = await Promise.all([
    admin.from('user_profiles').select('*').eq('id', userId).maybeSingle(),
    admin.from('financial_portrait').select('*').eq('user_id', userId),
    admin.from('onboarding_progress').select('*').eq('user_id', userId).maybeSingle(),
    admin.from('transactions').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    admin.from('messages').select('content').eq('user_id', userId).eq('role', 'assistant'),
    admin.from('recurring_expenses').select('name').eq('user_id', userId),
    admin.from('goals').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  ])

  return {
    user_profiles: profileRes.data ?? null,
    financial_portrait: portraitRes.data ?? null,
    onboarding_progress: progressRes.data ?? null,
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

export function assertDbState(persona: Persona, snapshot: DbStateSnapshot): string[] {
  const errors: string[] = []
  const expected = persona.expectations.dbAfterHandoff

  if (expected.user_profiles) {
    for (const [key, want] of Object.entries(expected.user_profiles)) {
      const got = (snapshot.user_profiles ?? {})[key]
      if (want === 'not-null') {
        if (got == null) errors.push(`user_profiles.${key}: expected not-null, got null`)
      } else if (got !== want) {
        errors.push(`user_profiles.${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
      }
    }
  }

  if (expected.financial_portrait) {
    const portrait = snapshot.financial_portrait ?? []
    for (const [key, want] of Object.entries(expected.financial_portrait)) {
      if (want === 'exists') {
        const has = portrait.some((p) => p.trait_key === key)
        if (!has) errors.push(`financial_portrait.${key}: expected to exist`)
      } else {
        const row = portrait.find((p) => p.trait_key === key)
        if (!row || row.trait_value !== want) {
          errors.push(`financial_portrait.${key}: expected trait_value=${JSON.stringify(want)}, got ${JSON.stringify(row?.trait_value)}`)
        }
      }
    }
  }

  if (expected.onboarding_progress) {
    for (const [key, want] of Object.entries(expected.onboarding_progress)) {
      const got = (snapshot.onboarding_progress ?? {})[key]
      if (want === 'not-null') {
        if (got == null) errors.push(`onboarding_progress.${key}: expected not-null, got null`)
      } else if (got !== want) {
        errors.push(`onboarding_progress.${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
      }
    }
  }

  if (expected.transactions?.countBetween) {
    const [min, max] = expected.transactions.countBetween
    if (snapshot.transactionCount < min || snapshot.transactionCount > max) {
      errors.push(`transactions.count: expected between ${min}-${max}, got ${snapshot.transactionCount}`)
    }
  }

  // Goal persistence check — persona with goal expects ≥1 row; persona without expects 0.
  if (persona.expectations.goal) {
    if (snapshot.goalsCount < 1) {
      errors.push(`goals: expected ≥1 row for goal-seeded persona, got ${snapshot.goalsCount}`)
    }
  } else {
    if (snapshot.goalsCount > 0) {
      errors.push(`goals: expected 0 rows for goal-less persona, got ${snapshot.goalsCount}`)
    }
  }

  // Universal fix invariants — apply to every persona regardless of expectations.
  errors.push(...assertNoValidatorNoteLeak(snapshot.assistantMessageContents))
  errors.push(...assertNoCaseDupRecurringNames(snapshot.recurringNames))

  return errors
}
