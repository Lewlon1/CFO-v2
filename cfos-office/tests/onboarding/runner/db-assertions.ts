import type { SupabaseClient } from '@supabase/supabase-js'
import type { Persona } from '../personas/types'
import type { DbStateSnapshot } from './types'

export async function snapshotDbState(admin: SupabaseClient, userId: string): Promise<DbStateSnapshot> {
  const [profileRes, portraitRes, progressRes, txnRes] = await Promise.all([
    admin.from('user_profiles').select('*').eq('id', userId).maybeSingle(),
    admin.from('financial_portrait').select('*').eq('user_id', userId),
    admin.from('onboarding_progress').select('*').eq('user_id', userId).maybeSingle(),
    admin.from('transactions').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  ])

  return {
    user_profiles: profileRes.data ?? null,
    financial_portrait: portraitRes.data ?? null,
    onboarding_progress: progressRes.data ?? null,
    transactionCount: txnRes.count ?? 0,
  }
}

export function assertDbState(persona: Persona, snapshot: DbStateSnapshot): string[] {
  const errors: string[] = []
  const expected = persona.expectations.dbAfterHandoff

  if (expected.user_profiles) {
    for (const [key, want] of Object.entries(expected.user_profiles)) {
      const got = (snapshot.user_profiles ?? {})[key]
      if (got !== want) {
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

  return errors
}
