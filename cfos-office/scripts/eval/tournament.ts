#!/usr/bin/env tsx
// Tournament: run champion + each candidate on every rated pair, compute
// agreement per fold with bootstrap CIs, decide who would be promotion-eligible.
//
//   npx tsx scripts/eval/tournament.ts [--challenger <filename> ...] [--no-cache]
//
// By default, ALL files in eval/judges/candidates/ are entered as challengers.
// The champion is always included (it's the reference). Predictions are cached
// per (pair, judgeId) on the pair JSON — re-running tournament after the
// champion has been calibrated only scores new judges.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { listPairs, type GoldenPair, type Winner } from './_lib/pair-storage'
import {
  loadJudge,
  loadChampion,
  scorePair,
  findCachedPrediction,
  judgesDir,
  type JudgeModule,
} from './_lib/judge-runner'
import { computeAgreement, checkPromotion, type AgreementResult } from './_lib/agreement'

// ── Args + env ───────────────────────────────────────────────────────────────

const ARGV = process.argv.slice(2)

function flagValues(name: string): string[] {
  const out: string[] = []
  for (let i = 0; i < ARGV.length; i++) {
    if (ARGV[i] === name) {
      if (ARGV[i + 1]) out.push(ARGV[i + 1])
    } else if (ARGV[i].startsWith(`${name}=`)) {
      out.push(ARGV[i].split('=').slice(1).join('='))
    }
  }
  return out
}

const EXPLICIT_CHALLENGERS = flagValues('--challenger')
const NO_CACHE = ARGV.includes('--no-cache')

// Env load
const ENV_CANDIDATES = [
  resolve(__dirname, '../../.env.local'),
  resolve(__dirname, '../../../cfos-office/.env.local'),
]
for (const candidate of ENV_CANDIDATES) {
  if (!existsSync(candidate)) continue
  for (const line of readFileSync(candidate, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const key = t.slice(0, eq).trim()
    const value = t.slice(eq + 1).trim()
    if (!process.env[key]) process.env[key] = value
  }
  break
}

// ── Candidate discovery ──────────────────────────────────────────────────────

function discoverCandidates(): string[] {
  if (EXPLICIT_CHALLENGERS.length > 0) return EXPLICIT_CHALLENGERS
  const dir = join(judgesDir(), 'candidates')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join('candidates', f))
}

// ── Path helpers ─────────────────────────────────────────────────────────────

function reportsDir(): string {
  return resolve(__dirname, '..', '..', 'eval', 'reports')
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`
}

// ── Scoring ──────────────────────────────────────────────────────────────────

async function scoreAllPairs(
  judge: JudgeModule,
  pairs: GoldenPair[],
): Promise<{ lewis: Winner; judge: Winner; fold: 'train' | 'holdout' }[]> {
  const picks: { lewis: Winner; judge: Winner; fold: 'train' | 'holdout' }[] = []
  for (const pair of pairs) {
    if (!pair.rating) continue
    const cached = !NO_CACHE ? findCachedPrediction(pair, judge.judgeId) : null
    let predicted: Winner
    if (cached) {
      predicted = cached.predicted_winner
      process.stdout.write('.')
    } else {
      const r = await scorePair(judge, pair)
      predicted = r.prediction.predicted_winner
      process.stdout.write('o')
    }
    picks.push({ lewis: pair.rating.winner, judge: predicted, fold: pair.fold })
  }
  return picks
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const rated = listPairs({ rated: true })
  if (rated.length === 0) {
    console.error('No rated pairs. Run rate.ts first.')
    process.exit(1)
  }

  const champion = await loadChampion()
  const candidateFiles = discoverCandidates()
  if (candidateFiles.length === 0) {
    console.log(`No candidates to evaluate. Drop files in eval/judges/candidates/ or pass --challenger.`)
    process.exit(0)
  }

  console.log(`Champion: ${champion.judgeId}`)
  console.log(`Candidates: ${candidateFiles.length}`)
  console.log(`Rated pairs: ${rated.length}`)
  console.log('')

  // Score the champion first (reference)
  console.log(`Scoring champion (${champion.judgeId})…`)
  const championPicks = await scoreAllPairs(champion, rated)
  console.log('')
  const championTrain = computeAgreement(
    championPicks.filter((p) => p.fold === 'train').map(({ lewis, judge }) => ({ lewis, judge })),
    { bootstrap: 1000 },
  )
  const championHoldout = computeAgreement(
    championPicks.filter((p) => p.fold === 'holdout').map(({ lewis, judge }) => ({ lewis, judge })),
    { bootstrap: 1000 },
  )

  // Score each candidate
  interface Row {
    judgeId: string
    train: AgreementResult
    holdout: AgreementResult
    eligible: boolean
    reason: string
  }
  const rows: Row[] = []
  for (const candidateFile of candidateFiles) {
    const judge = await loadJudge(candidateFile)
    console.log(`Scoring candidate (${judge.judgeId})…`)
    const picks = await scoreAllPairs(judge, rated)
    console.log('')
    const train = computeAgreement(
      picks.filter((p) => p.fold === 'train').map(({ lewis, judge }) => ({ lewis, judge })),
      { bootstrap: 1000 },
    )
    const holdout = computeAgreement(
      picks.filter((p) => p.fold === 'holdout').map(({ lewis, judge }) => ({ lewis, judge })),
      { bootstrap: 1000 },
    )
    const decision = checkPromotion({
      champion: { train: championTrain, holdout: championHoldout },
      candidate: { train, holdout },
    })
    rows.push({
      judgeId: judge.judgeId,
      train,
      holdout,
      eligible: decision.eligible,
      reason: decision.reason,
    })
  }

  // ── Console table ─────────────────────────────────────────────────────────

  console.log('─'.repeat(80))
  console.log(
    'Judge'.padEnd(38) +
      ' '.padEnd(2) +
      'Train %'.padStart(8) +
      'Holdout %'.padStart(11) +
      '  Promote?',
  )
  console.log('─'.repeat(80))
  console.log(
    `${('champion: ' + champion.judgeId).slice(0, 38).padEnd(38)}  ${pct(championTrain.agreement).padStart(7)}${pct(championHoldout.agreement).padStart(10)}    —`,
  )
  for (const r of rows) {
    const mark = r.eligible ? '✓' : '✗'
    console.log(
      `${r.judgeId.slice(0, 38).padEnd(38)}  ${pct(r.train.agreement).padStart(7)}${pct(r.holdout.agreement).padStart(10)}    ${mark}`,
    )
  }
  console.log('─'.repeat(80))

  // List eligible candidates
  const eligible = rows.filter((r) => r.eligible)
  if (eligible.length > 0) {
    console.log(`\n${eligible.length} eligible candidate${eligible.length === 1 ? '' : 's'}:`)
    for (const r of eligible) {
      console.log(`  • ${r.judgeId}  —  ${r.reason}`)
    }
    console.log(`\nPromote with:`)
    for (const r of eligible) {
      console.log(`  npx tsx scripts/eval/promote.ts cand-${r.judgeId.replace(/^cand-/, '')}.ts`)
    }
  } else {
    console.log('\nNo candidate eligible for promotion. Champion stays.')
    for (const r of rows) {
      console.log(`  • ${r.judgeId}: ${r.reason}`)
    }
  }

  // Write report
  mkdirSync(reportsDir(), { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = join(reportsDir(), `${ts}-tournament.md`)
  const md = buildReportMd({
    championId: champion.judgeId,
    championTrain,
    championHoldout,
    rows,
  })
  writeFileSync(reportPath, md, 'utf-8')
  console.log(`\nReport: ${reportPath}\n`)
}

function buildReportMd(input: {
  championId: string
  championTrain: AgreementResult
  championHoldout: AgreementResult
  rows: Array<{ judgeId: string; train: AgreementResult; holdout: AgreementResult; eligible: boolean; reason: string }>
}): string {
  const lines: string[] = []
  lines.push(`# Tournament — champion ${input.championId}`)
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push('')
  lines.push('## Results')
  lines.push('')
  lines.push('| Judge | Train | Holdout | Train CI95 | Holdout CI95 | Promote? |')
  lines.push('|---|---|---|---|---|---|')
  const trainCI = (a: AgreementResult) => a.ci95 ? `[${pct(a.ci95.low)}, ${pct(a.ci95.high)}]` : '—'
  lines.push(`| **champion: ${input.championId}** | ${pct(input.championTrain.agreement)} | ${pct(input.championHoldout.agreement)} | ${trainCI(input.championTrain)} | ${trainCI(input.championHoldout)} | — |`)
  for (const r of input.rows) {
    const mark = r.eligible ? '✓' : '✗'
    lines.push(`| ${r.judgeId} | ${pct(r.train.agreement)} | ${pct(r.holdout.agreement)} | ${trainCI(r.train)} | ${trainCI(r.holdout)} | ${mark} |`)
  }
  lines.push('')
  lines.push('## Promotion eligibility')
  lines.push('')
  for (const r of input.rows) {
    lines.push(`- **${r.judgeId}** — ${r.eligible ? '✓ eligible' : '✗ rejected'}: ${r.reason}`)
  }
  return lines.join('\n')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
