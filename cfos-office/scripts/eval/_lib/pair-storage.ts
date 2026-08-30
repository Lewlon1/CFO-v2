// Golden-set pair storage. One JSON file per pair under
// cfos-office/eval/golden-set/pairs/. Self-contained — the file captures the
// inputs, both responses, the human rating (or null), and every judge run's
// predictions appended over time.

import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { hashPrompt } from '../../../src/lib/ai/experiment-metadata'

// ── Types ─────────────────────────────────────────────────────────────────────

export type Fold = 'train' | 'holdout'

export type Source = 'compare-first-insight' | 'persona-suite' | 'manual'

export type Side = 'a' | 'b'

export type Winner = Side | 'tie'

// Loose ToolCall shape — matches the Vercel AI SDK output. Kept permissive so
// future judges/captures don't need a coordinated schema change.
export interface ToolCall {
  toolName: string
  args?: unknown
  output?: unknown
}

export interface PromptVariant {
  label: string                  // e.g. 'v1' / 'v2' / 'v2.1-tighter-length'
  hash: string                   // sha256 of the system prompt (first 16 chars)
}

export interface ResponseRecord {
  text: string
  tool_calls: ToolCall[]
  tokens: { in: number; out: number }
}

export interface Rating {
  winner: Winner
  rater: string                  // 'lewis' for now; future: panel members
  rated_at: string               // ISO
  notes: string | null
}

export interface JudgePrediction {
  judge_id: string
  run_at: string
  score_a: number
  score_b: number
  predicted_winner: Winner
  diagnostic: Record<string, number>
  reasoning_a?: string           // optional — kept for diagnose to read
  reasoning_b?: string
}

export interface GoldenPair {
  pair_id: string
  created_at: string
  source: Source
  fold: Fold
  input: {
    persona_id: string | null
    user_id: string
    trigger_message: string
    known_merchants: string[]
    user_brief: string
    prompt_variants: { a: PromptVariant; b: PromptVariant }
  }
  responses: { a: ResponseRecord; b: ResponseRecord }
  rating: Rating | null
  judge_predictions: JudgePrediction[]
}

// ── Paths ─────────────────────────────────────────────────────────────────────

// Repo-relative resolution. Resolved relative to cfos-office/ regardless of
// where the calling script lives — we look up from the current file to find
// the cfos-office root.
function findCfosOfficeRoot(): string {
  // This file lives at cfos-office/scripts/eval/_lib/pair-storage.ts → walk
  // up two dirs from __dirname to reach cfos-office/.
  return resolve(__dirname, '..', '..', '..')
}

export function pairsDir(): string {
  return join(findCfosOfficeRoot(), 'eval', 'golden-set', 'pairs')
}

export function pairPath(pairId: string): string {
  return join(pairsDir(), `${pairId}.json`)
}

// ── Fold assignment ───────────────────────────────────────────────────────────
// Deterministic — hash the pair_id and slice the first 4 hex chars as a
// 16-bit integer in [0, 65536). Holdout if % 5 === 0 (~20% holdout). Stable
// across calls because the hash is deterministic and the pair_id never changes.

export const HOLDOUT_BUCKET_COUNT = 5  // 1 in N → holdout

export function assignFold(pairId: string): Fold {
  const digest = createHash('sha256').update(pairId).digest('hex')
  const bucket = parseInt(digest.slice(0, 4), 16) % HOLDOUT_BUCKET_COUNT
  return bucket === 0 ? 'holdout' : 'train'
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function generatePairId(): string {
  return randomUUID()
}

// Re-exported (imported at the top of this file) so a prompt hashed here
// matches the same prompt hashed into an llm_usage_log row — a stored pair and
// a production call have to be joinable, and two implementations of "sha256,
// first 16" would drift silently.
export { hashPrompt }

// ── Round-trip IO ─────────────────────────────────────────────────────────────

export function writePair(pair: GoldenPair): void {
  const dir = pairsDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(pairPath(pair.pair_id), JSON.stringify(pair, null, 2) + '\n', 'utf-8')
}

export function readPair(pairId: string): GoldenPair {
  const path = pairPath(pairId)
  if (!existsSync(path)) {
    throw new Error(`pair-storage: pair ${pairId} not found at ${path}`)
  }
  return JSON.parse(readFileSync(path, 'utf-8')) as GoldenPair
}

export function listPairIds(): string[] {
  const dir = pairsDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort()
}

export function listPairs(filter?: { fold?: Fold; rated?: boolean }): GoldenPair[] {
  const out: GoldenPair[] = []
  for (const id of listPairIds()) {
    const p = readPair(id)
    if (filter?.fold && p.fold !== filter.fold) continue
    if (filter?.rated === true && p.rating === null) continue
    if (filter?.rated === false && p.rating !== null) continue
    out.push(p)
  }
  return out
}

// ── Construction helper ───────────────────────────────────────────────────────
// Used by capture scripts to assemble a new pair record consistently. The fold
// is computed from the pair_id at construction time; everything else is the
// caller's responsibility.

export interface NewPairInput {
  source: Source
  persona_id: string | null
  user_id: string
  trigger_message: string
  known_merchants: string[]
  user_brief: string
  variant_a: { label: string; system_prompt: string }
  variant_b: { label: string; system_prompt: string }
  response_a: ResponseRecord
  response_b: ResponseRecord
}

export function buildPair(input: NewPairInput): GoldenPair {
  const pair_id = generatePairId()
  return {
    pair_id,
    created_at: new Date().toISOString(),
    source: input.source,
    fold: assignFold(pair_id),
    input: {
      persona_id: input.persona_id,
      user_id: input.user_id,
      trigger_message: input.trigger_message,
      known_merchants: input.known_merchants,
      user_brief: input.user_brief,
      prompt_variants: {
        a: { label: input.variant_a.label, hash: hashPrompt(input.variant_a.system_prompt) },
        b: { label: input.variant_b.label, hash: hashPrompt(input.variant_b.system_prompt) },
      },
    },
    responses: { a: input.response_a, b: input.response_b },
    rating: null,
    judge_predictions: [],
  }
}

// ── Rating update ─────────────────────────────────────────────────────────────

export function applyRating(pairId: string, rating: Rating): GoldenPair {
  const pair = readPair(pairId)
  pair.rating = rating
  writePair(pair)
  return pair
}

// ── Judge prediction append ──────────────────────────────────────────────────
// Appended, never overwritten — multiple judges and reruns are kept so
// calibration can do diffs across champion versions over time.

export function appendJudgePrediction(pairId: string, pred: JudgePrediction): GoldenPair {
  const pair = readPair(pairId)
  pair.judge_predictions.push(pred)
  writePair(pair)
  return pair
}

// ── Winner derivation from scalar scores ──────────────────────────────────────
// The tie band guards against judge noise becoming a winner — two near-equal
// scores stay 'tie' rather than flipping on a coin-toss. Single source of
// truth used by every judge runner.

export const TIE_BAND = 0.02

export function deriveWinner(scoreA: number, scoreB: number, tieBand = TIE_BAND): Winner {
  const gap = scoreA - scoreB
  if (gap > tieBand) return 'a'
  if (gap < -tieBand) return 'b'
  return 'tie'
}
