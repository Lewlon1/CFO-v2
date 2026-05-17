// Judge-runner: the invocation interface every judge module implements, plus
// the harness that runs a judge against a GoldenPair and appends a JudgePrediction.
//
// A judge module exports two things:
//   1. `judgeId`: stable string identifier (e.g. "2026-05-17-baseline")
//   2. `score(input)`: async function that returns a JudgeScore for ONE response
//
// The runner scores both responses of a pair, derives the pairwise winner
// from the scalars (via pair-storage.deriveWinner), and writes the prediction
// back to the pair JSON.

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  appendJudgePrediction,
  deriveWinner,
  type GoldenPair,
  type JudgePrediction,
  type ResponseRecord,
} from './pair-storage'

// ── Judge module interface ────────────────────────────────────────────────────
// Every judge under eval/judges/ implements this. Both champion and
// candidates. The diagnose meta-judge reads `reasoning` and the diagnostic
// sub-scores to find disagreement patterns.

export interface JudgeInput {
  /** Single response under evaluation. */
  response: ResponseRecord
  /** Context the response was generated against. */
  user_brief: string
  known_merchants: string[]
  /** Optional persona id for persona-aware judges. */
  persona_id: string | null
}

export interface JudgeScore {
  wow_score: number              // [0,1] — THE scoring signal
  diagnostic: Record<string, number>  // sub-scores; judge-defined keys
  reasoning: string              // 1-2 sentences; for diagnose
}

export interface JudgeModule {
  judgeId: string
  score(input: JudgeInput): Promise<JudgeScore>
}

// ── Champion resolution ───────────────────────────────────────────────────────

function findCfosOfficeRoot(): string {
  return resolve(__dirname, '..', '..', '..')
}

export function judgesDir(): string {
  return join(findCfosOfficeRoot(), 'eval', 'judges')
}

export function championPointerPath(): string {
  return join(judgesDir(), 'CHAMPION')
}

export function judgeFilePath(filename: string): string {
  // Filename can be either bare ("2026-05-17-baseline.ts"), under archive/,
  // or under candidates/. Resolve in order.
  const direct = join(judgesDir(), filename)
  if (existsSync(direct)) return direct
  const archive = join(judgesDir(), 'archive', filename)
  if (existsSync(archive)) return archive
  const candidate = join(judgesDir(), 'candidates', filename)
  if (existsSync(candidate)) return candidate
  throw new Error(`judge-runner: judge file not found: ${filename}`)
}

export function readChampionFilename(): string {
  const pointer = championPointerPath()
  if (!existsSync(pointer)) {
    throw new Error(
      `judge-runner: champion pointer ${pointer} does not exist. ` +
      `Create eval/judges/CHAMPION with one line: the active champion's filename.`,
    )
  }
  const content = readFileSync(pointer, 'utf-8').trim()
  if (!content) {
    throw new Error(`judge-runner: champion pointer ${pointer} is empty`)
  }
  // Take the first non-comment, non-empty line. # comments allowed.
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    return trimmed
  }
  throw new Error(`judge-runner: champion pointer ${pointer} has no filename`)
}

// ── Dynamic judge loading ─────────────────────────────────────────────────────
// Uses dynamic import so the runner can pick a judge at runtime (champion vs
// candidates) without knowing them at compile time.

export async function loadJudge(filename: string): Promise<JudgeModule> {
  const path = judgeFilePath(filename)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import(path)
  if (typeof mod.judgeId !== 'string' || typeof mod.score !== 'function') {
    throw new Error(
      `judge-runner: ${filename} does not export {judgeId: string, score: function}`,
    )
  }
  return { judgeId: mod.judgeId, score: mod.score }
}

export async function loadChampion(): Promise<JudgeModule> {
  return loadJudge(readChampionFilename())
}

// ── Pair scoring ──────────────────────────────────────────────────────────────

export interface ScorePairResult {
  prediction: JudgePrediction
  pair: GoldenPair
}

/**
 * Score both sides of a pair with the given judge. Appends a JudgePrediction
 * to the pair's history and returns the (updated pair, prediction) tuple.
 *
 * The `writeBack` flag controls whether the prediction is persisted. Default
 * true. Pass false from tournament/calibrate when you want batched writes.
 */
export async function scorePair(
  judge: JudgeModule,
  pair: GoldenPair,
  opts: { writeBack?: boolean } = {},
): Promise<ScorePairResult> {
  const writeBack = opts.writeBack ?? true

  const inputA: JudgeInput = {
    response: pair.responses.a,
    user_brief: pair.input.user_brief,
    known_merchants: pair.input.known_merchants,
    persona_id: pair.input.persona_id,
  }
  const inputB: JudgeInput = {
    response: pair.responses.b,
    user_brief: pair.input.user_brief,
    known_merchants: pair.input.known_merchants,
    persona_id: pair.input.persona_id,
  }

  // Score in parallel — they're independent and Bedrock can handle two
  // concurrent calls fine.
  const [scoreA, scoreB] = await Promise.all([judge.score(inputA), judge.score(inputB)])

  const prediction: JudgePrediction = {
    judge_id: judge.judgeId,
    run_at: new Date().toISOString(),
    score_a: scoreA.wow_score,
    score_b: scoreB.wow_score,
    predicted_winner: deriveWinner(scoreA.wow_score, scoreB.wow_score),
    diagnostic: mergeDiagnostic(scoreA.diagnostic, scoreB.diagnostic),
    reasoning_a: scoreA.reasoning,
    reasoning_b: scoreB.reasoning,
  }

  let updatedPair = pair
  if (writeBack) {
    updatedPair = appendJudgePrediction(pair.pair_id, prediction)
  }

  return { prediction, pair: updatedPair }
}

// ── Cache lookup ──────────────────────────────────────────────────────────────
// Calibrate / tournament don't need to re-run judges that have already scored
// a given pair. This helper finds the most recent prediction by a given
// judgeId in the pair's history.

export function findCachedPrediction(
  pair: GoldenPair,
  judgeId: string,
): JudgePrediction | null {
  const matches = pair.judge_predictions.filter((p) => p.judge_id === judgeId)
  if (matches.length === 0) return null
  // Latest by run_at (ISO strings sort lexicographically).
  matches.sort((a, b) => (a.run_at < b.run_at ? 1 : -1))
  return matches[0]
}

// ── Diagnostic merge ──────────────────────────────────────────────────────────
// For a pair, diagnostic sub-scores are merged with side prefixes so the
// diagnose meta-judge can see per-side detail.

function mergeDiagnostic(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(a)) out[`a.${k}`] = v
  for (const [k, v] of Object.entries(b)) out[`b.${k}`] = v
  return out
}
