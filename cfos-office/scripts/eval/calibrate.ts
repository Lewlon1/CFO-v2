#!/usr/bin/env tsx
// Calibration: runs the current champion judge on every rated pair, derives
// per-pair predictions, computes train/holdout agreement, and writes a
// markdown report.
//
//   npx tsx scripts/eval/calibrate.ts [--judge <filename>] [--no-bootstrap]
//
// Caching: predictions are stored on each pair's judge_predictions[]. If the
// active judge has already scored a pair (matched by judge_id), the cached
// prediction is reused. Pass --refresh to force re-scoring.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { listPairs, type GoldenPair, type Winner } from './_lib/pair-storage'
import {
  loadJudge,
  loadChampion,
  scorePair,
  findCachedPrediction,
} from './_lib/judge-runner'
import {
  computeAgreement,
  type AgreementResult,
} from './_lib/agreement'

// ── Args ─────────────────────────────────────────────────────────────────────

const ARGV = process.argv.slice(2)

function flagValue(name: string, fallback: string | null = null): string | null {
  const idx = ARGV.findIndex((a) => a === name || a.startsWith(`${name}=`))
  if (idx === -1) return fallback
  const v = ARGV[idx]
  if (v.includes('=')) return v.split('=').slice(1).join('=')
  return ARGV[idx + 1] ?? fallback
}

const NO_BOOTSTRAP = ARGV.includes('--no-bootstrap')
const FORCE_REFRESH = ARGV.includes('--refresh')
const JUDGE_FILE = flagValue('--judge')

// ── Env load (mirrors compare-first-insight.ts setup) ────────────────────────

import { readFileSync, existsSync } from 'node:fs'
const ENV_CANDIDATES = [
  resolve(__dirname, '../../.env.local'),
  resolve(__dirname, '../../../cfos-office/.env.local'),
]
for (const candidate of ENV_CANDIDATES) {
  if (!existsSync(candidate)) continue
  for (const line of readFileSync(candidate, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (!process.env[key]) process.env[key] = value
  }
  break
}

// ── Report path ──────────────────────────────────────────────────────────────

function reportsDir(): string {
  return resolve(__dirname, '..', '..', 'eval', 'reports')
}

function reportPath(timestamp: string): string {
  return join(reportsDir(), `${timestamp}-calibrate.md`)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function dim(s: string): string {
  return process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const judge = JUDGE_FILE ? await loadJudge(JUDGE_FILE) : await loadChampion()
  console.log(`Calibrating judge: ${judge.judgeId}\n`)

  const rated = listPairs({ rated: true })
  if (rated.length === 0) {
    console.log('No rated pairs in golden set. Run scripts/eval/rate.ts first.')
    process.exit(0)
  }

  console.log(`${rated.length} rated pair${rated.length === 1 ? '' : 's'}.`)
  console.log(dim('Scoring (cached predictions reused unless --refresh)…\n'))

  interface PerPairRow {
    pair_id: string
    fold: 'train' | 'holdout'
    lewis: Winner
    judge: Winner
    score_a: number
    score_b: number
    gap: number
    cached: boolean
    reasoning_a?: string
    reasoning_b?: string
  }

  const rows: PerPairRow[] = []

  for (const pair of rated) {
    if (!pair.rating) continue
    const cached = !FORCE_REFRESH ? findCachedPrediction(pair, judge.judgeId) : null
    let prediction
    if (cached) {
      prediction = cached
    } else {
      const result = await scorePair(judge, pair)
      prediction = result.prediction
    }
    rows.push({
      pair_id: pair.pair_id,
      fold: pair.fold,
      lewis: pair.rating.winner,
      judge: prediction.predicted_winner,
      score_a: prediction.score_a,
      score_b: prediction.score_b,
      gap: prediction.score_a - prediction.score_b,
      cached: cached !== null,
      reasoning_a: prediction.reasoning_a,
      reasoning_b: prediction.reasoning_b,
    })
    process.stdout.write(cached ? dim('.') : 'o')
  }
  console.log('\n')

  // Split by fold and compute agreement.
  const trainPicks = rows.filter((r) => r.fold === 'train').map((r) => ({ lewis: r.lewis, judge: r.judge }))
  const holdoutPicks = rows.filter((r) => r.fold === 'holdout').map((r) => ({ lewis: r.lewis, judge: r.judge }))

  const bootstrapIters = NO_BOOTSTRAP ? 0 : 1000
  const train = computeAgreement(trainPicks, { bootstrap: bootstrapIters })
  const holdout = computeAgreement(holdoutPicks, { bootstrap: bootstrapIters })

  // Console summary
  console.log('─'.repeat(72))
  console.log(`Judge: ${judge.judgeId}`)
  printAgreement('Train  ', train)
  printAgreement('Holdout', holdout)
  console.log('─'.repeat(72))

  // Confusion (which pairs the judge got wrong)
  const wrong = rows.filter((r) => {
    if (r.lewis === r.judge) return false
    // Don't count tie/non-tie as fully wrong here — only clean misses (a/b vs b/a)
    return !(r.lewis === 'tie' || r.judge === 'tie')
  })
  console.log(`Clean misses (Lewis A vs judge B, or vice-versa): ${wrong.length}`)
  for (const r of wrong.slice(0, 10)) {
    console.log(dim(`  ${r.pair_id.slice(0, 8)}  fold=${r.fold}  lewis=${r.lewis} judge=${r.judge}  scoreA=${r.score_a.toFixed(2)} scoreB=${r.score_b.toFixed(2)}`))
  }
  if (wrong.length > 10) console.log(dim(`  ... + ${wrong.length - 10} more`))

  // Write report
  mkdirSync(reportsDir(), { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const path = reportPath(ts)
  const md = buildReportMd({ judgeId: judge.judgeId, train, holdout, rows, wrong })
  writeFileSync(path, md, 'utf-8')
  console.log(`\nReport: ${path}\n`)
}

function printAgreement(label: string, r: AgreementResult): void {
  if (r.count === 0) {
    console.log(`${label} agreement: — (0 pairs)`)
    return
  }
  const ci = r.ci95 ? `  CI95 [${pct(r.ci95.low)}, ${pct(r.ci95.high)}]` : ''
  console.log(
    `${label} agreement: ${pct(r.agreement).padStart(6)}  (${r.matches}/${r.count} full match, ${r.half_matches} half, ${r.misses} miss)${ci}`,
  )
}

function buildReportMd(input: {
  judgeId: string
  train: AgreementResult
  holdout: AgreementResult
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wrong: any[]
}): string {
  const lines: string[] = []
  lines.push(`# Calibration — ${input.judgeId}`)
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push('')
  lines.push('## Headline')
  lines.push('')
  lines.push(`- Train agreement: **${pct(input.train.agreement)}** (${input.train.matches}/${input.train.count} full, ${input.train.half_matches} half, ${input.train.misses} miss)`)
  if (input.train.ci95) lines.push(`  - CI95: [${pct(input.train.ci95.low)}, ${pct(input.train.ci95.high)}]`)
  lines.push(`- Holdout agreement: **${pct(input.holdout.agreement)}** (${input.holdout.matches}/${input.holdout.count} full, ${input.holdout.half_matches} half, ${input.holdout.misses} miss)`)
  if (input.holdout.ci95) lines.push(`  - CI95: [${pct(input.holdout.ci95.low)}, ${pct(input.holdout.ci95.high)}]`)
  lines.push('')

  lines.push('## Per-pair predictions')
  lines.push('')
  lines.push('| pair_id (short) | fold | lewis | judge | score_a | score_b | match? |')
  lines.push('|---|---|---|---|---|---|---|')
  for (const r of input.rows) {
    const match = r.lewis === r.judge ? '✓' : (r.lewis === 'tie' || r.judge === 'tie' ? '~' : '✗')
    lines.push(
      `| \`${r.pair_id.slice(0, 8)}\` | ${r.fold} | ${r.lewis} | ${r.judge} | ${r.score_a.toFixed(2)} | ${r.score_b.toFixed(2)} | ${match} |`,
    )
  }
  lines.push('')

  if (input.wrong.length > 0) {
    lines.push('## Clean misses')
    lines.push('')
    lines.push('Pairs where Lewis and the judge picked opposing sides (no ties on either side). The diagnose step focuses on these.')
    lines.push('')
    for (const r of input.wrong) {
      lines.push(`### \`${r.pair_id}\` (fold=${r.fold})`)
      lines.push('')
      lines.push(`Lewis: **${r.lewis}**  |  Judge: **${r.judge}**  |  score_a=${r.score_a.toFixed(2)}  score_b=${r.score_b.toFixed(2)}`)
      lines.push('')
      if (r.reasoning_a) lines.push(`Reasoning A: ${r.reasoning_a}`)
      if (r.reasoning_b) lines.push(`Reasoning B: ${r.reasoning_b}`)
      lines.push('')
    }
  }

  return lines.join('\n')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
