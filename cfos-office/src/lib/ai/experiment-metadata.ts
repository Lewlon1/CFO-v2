// Experiment attribution for LLM calls.
//
// `llm_usage_log` records what a call cost but not what prompt produced it, and
// no prompt text is persisted anywhere. That is fine until you run two prompt
// variants against each other, at which point every row is unattributable and
// the cost columns cannot answer which arm they belong to.
//
// These fields go into the row's `metadata` jsonb (already free-form, already
// used this way for `mode`), so measuring an A/B run is a GROUP BY rather than
// a schema change.
//
// Nothing here is required for a normal request: with no experiment env vars
// set, the stamp is just the cabinet's current state.

import { createHash } from 'node:crypto'
import { isMemoryFilesEnabled } from '@/lib/memory/flags'

/**
 * The prompt-identity convention: sha256, first 16 chars.
 *
 * Shared with the golden-set pair store (scripts/eval/_lib/pair-storage.ts
 * re-exports this one) because a hash is only useful if the same prompt hashes
 * identically on both sides — a production row and a rated pair have to be
 * joinable, and two independent implementations would silently drift.
 */
export function hashPrompt(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 16)
}

export interface ExperimentStamp {
  /** Which arm of the filing-cabinet A/B this call ran under. */
  memory_files_enabled: boolean
  /** Groups every call in one experiment run. Set EXPERIMENT_RUN_ID to populate. */
  run_id?: string
  /** Human-readable arm label, e.g. 'cabinet-off'. Set EXPERIMENT_VARIANT. */
  prompt_variant?: string
  /** Identifies the exact prompt text, so an arm can be proved to have differed. */
  prompt_hash?: string
}

/**
 * Build the experiment fields for an `llm_usage_log` row. Read from the
 * environment per call, never memoised at module load, so a restart with new
 * env values is enough to switch arms.
 */
export function experimentStamp(promptHash?: string): ExperimentStamp {
  const runId = process.env.EXPERIMENT_RUN_ID
  const variant = process.env.EXPERIMENT_VARIANT
  return {
    memory_files_enabled: isMemoryFilesEnabled(),
    ...(runId ? { run_id: runId } : {}),
    ...(variant ? { prompt_variant: variant } : {}),
    ...(promptHash ? { prompt_hash: promptHash } : {}),
  }
}
