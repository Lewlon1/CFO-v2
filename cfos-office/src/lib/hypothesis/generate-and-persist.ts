import type { SupabaseClient } from '@supabase/supabase-js'
import { buildHypothesisSourceSignals } from './source-signals'
import { generateHypothesis, meanConfidence } from './generator'
import { validateHypothesis } from './validator'

export type HypothesisGeneratedFrom =
  | 'csv_upload'
  | 'value_map_complete'
  | 'periodic_refresh'
  | 'manual'

/**
 * End-to-end hypothesis generation: read signals → Haiku → validate → persist.
 * Marks any existing active hypothesis as superseded before insert so the
 * partial index "where superseded_at is null" stays a singleton per user.
 *
 * Designed for fire-and-forget use inside `after()` blocks — any failure
 * is logged but never thrown, so callers can wire it in without try/catch.
 */
export async function generateAndPersistHypothesis(
  supabase: SupabaseClient,
  userId: string,
  generatedFrom: HypothesisGeneratedFrom,
): Promise<void> {
  try {
    const signals = await buildHypothesisSourceSignals(supabase, userId)
    const output = await generateHypothesis(signals)
    if (!output) return

    const validation = validateHypothesis(output)
    if (!validation.ok) {
      await supabase.from('user_events').insert({
        profile_id: userId,
        event_type: 'hypothesis_validator_fired',
        event_category: 'hypothesis',
        payload: { reason: validation.reason, offenders: validation.offenders },
        context: { generated_from: generatedFrom },
      })
      return
    }

    await supabase
      .from('user_hypotheses')
      .update({ superseded_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('superseded_at', null)

    const { data: row } = await supabase
      .from('user_hypotheses')
      .insert({
        user_id: userId,
        thesis_lines: output.lines.map((l) => ({ ...l, status: 'open' as const })),
        confidence: meanConfidence(output.lines),
        source_signals: signals,
        generated_from: generatedFrom,
        raw_llm_response: output,
      })
      .select('id')
      .single()

    if (row?.id) {
      await supabase
        .from('user_hypotheses')
        .update({ superseded_by: row.id })
        .eq('user_id', userId)
        .neq('id', row.id)
        .not('superseded_at', 'is', null)
        .is('superseded_by', null)
    }
  } catch (err) {
    console.error('[hypothesis] generate-and-persist failed silently:', err)
  }
}
