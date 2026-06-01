#!/usr/bin/env tsx
// Diagnose: meta-judge analyses pairs where the champion disagreed with Lewis
// and proposes 2-3 prompt mutations as candidate judge files.
//
//   npx tsx scripts/eval/diagnose.ts [--judge <filename>] [--max-mutations N]
//
// The meta-judge sees:
//   - The full source of the active champion judge file
//   - The CFO Constitution (CFO-CONSTITUTION.md at repo root)
//   - The disagreement set: response A, response B, judge's predictions +
//     reasoning, Lewis's pick, for each pair where Lewis disagreed with the
//     champion's predicted_winner.
//
// It returns a cluster summary + 2-3 mutation proposals. Each mutation
// becomes a candidate file under eval/judges/candidates/ — a verbatim copy
// of the champion source with only the prompt body swapped and the judgeId
// updated. The candidate is then ready for `tournament.ts` to score.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { generateObject } from 'ai'

import {
  listPairs,
  type GoldenPair,
  type JudgePrediction,
} from './_lib/pair-storage'
import {
  loadJudge,
  loadChampion,
  judgesDir,
  findCachedPrediction,
  type JudgeModule,
} from './_lib/judge-runner'

// ── Args + env ───────────────────────────────────────────────────────────────

const ARGV = process.argv.slice(2)

function flagValue(name: string, fallback: string | null = null): string | null {
  const idx = ARGV.findIndex((a) => a === name || a.startsWith(`${name}=`))
  if (idx === -1) return fallback
  const v = ARGV[idx]
  if (v.includes('=')) return v.split('=').slice(1).join('=')
  return ARGV[idx + 1] ?? fallback
}

const MAX_MUTATIONS = Number(flagValue('--max-mutations', '3') ?? 3)
const JUDGE_FILE = flagValue('--judge')

// ── Env load ─────────────────────────────────────────────────────────────────

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

// ── Paths ────────────────────────────────────────────────────────────────────

function reportsDir(): string {
  return resolve(__dirname, '..', '..', 'eval', 'reports')
}

function candidatesDir(): string {
  return join(judgesDir(), 'candidates')
}

function repoRoot(): string {
  return resolve(__dirname, '..', '..', '..')
}

function constitutionPath(): string {
  return join(repoRoot(), 'CFO-CONSTITUTION.md')
}

// ── Meta-judge schema ────────────────────────────────────────────────────────

const MutationSchema = z.object({
  id: z
    .string()
    .min(3)
    .max(60)
    .describe('Short kebab-case identifier — e.g. "merchant-time-signal-bonus".'),
  rationale: z
    .string()
    .min(20)
    .max(400)
    .describe('1-3 sentences: why this mutation should address the disagreement pattern.'),
  predicted_effect: z
    .string()
    .min(10)
    .max(300)
    .describe('Which diagnostic sub-scores you expect this mutation to move, and in which direction.'),
  new_prompt_body: z
    .string()
    .min(200)
    .describe(
      'Full text of the new buildPrompt return value (a template literal starting with "You are calibrating..."). This replaces the existing buildPrompt return. Preserve the same overall structure — sections, scoring dimensions, return-format instructions — and apply your targeted edit.',
    ),
})

const MetaJudgeSchema = z.object({
  cluster_summary: z
    .string()
    .min(20)
    .max(500)
    .describe(
      '1-3 sentences naming the dominant pattern in the disagreement set. Concrete. ' +
      'E.g. "Champion undervalues responses pairing named merchant + temporal cue; Lewis consistently prefers concrete-noun ones over aggregate-heavy ones."',
    ),
  mutations: z.array(MutationSchema).min(1).max(5),
})

// ── Build meta-judge prompt ──────────────────────────────────────────────────

interface DisagreementRow {
  pair_id: string
  fold: 'train' | 'holdout'
  lewis_winner: string
  judge_winner: string
  response_a_text: string
  response_b_text: string
  judge_score_a: number
  judge_score_b: number
  reasoning_a?: string
  reasoning_b?: string
  user_brief: string
}

function buildMetaPrompt(input: {
  championSource: string
  constitution: string
  disagreements: DisagreementRow[]
  maxMutations: number
}): string {
  const disagreementBlock = input.disagreements
    .map((d, i) => {
      return `### Pair ${i + 1}  (\`${d.pair_id.slice(0, 8)}\`, fold=${d.fold})

User brief: ${d.user_brief.slice(0, 300)}

**Lewis picked:** ${d.lewis_winner}    **Judge picked:** ${d.judge_winner}    judge_score_a=${d.judge_score_a.toFixed(2)} judge_score_b=${d.judge_score_b.toFixed(2)}

Response A:
\`\`\`
${truncate(d.response_a_text, 1200)}
\`\`\`

Response B:
\`\`\`
${truncate(d.response_b_text, 1200)}
\`\`\`

Judge's reasoning (A): ${d.reasoning_a ?? '(none)'}
Judge's reasoning (B): ${d.reasoning_b ?? '(none)'}
`
    })
    .join('\n---\n')

  return `You are improving an LLM-as-judge that scores "wow factor" on CFO first-insight responses. Your job: look at the pairs where the current champion judge picked the wrong winner (vs human ground truth from Lewis), find the dominant pattern, and propose surgical mutations to the champion's prompt that should fix it.

## CFO Constitution (the source of truth on what "wow" means)

${input.constitution.slice(0, 12000)}

## Current champion judge — full source

\`\`\`typescript
${input.championSource}
\`\`\`

## Disagreement set

The champion's predicted winner diverged from Lewis's pick on these pairs. Lewis is the source of truth. Your job is to figure out *why* the champion is systematically wrong on this cluster.

${disagreementBlock}

## Your output

Return:

1. **cluster_summary**: 1-3 concrete sentences naming the dominant pattern. Avoid vague summaries — name the specific dimension the champion is misjudging.

2. **mutations**: up to ${input.maxMutations} proposals. Each is a SURGICAL edit to the champion's prompt body — not a whole-prompt rewrite. Preserve:
   - The overall section structure
   - The list of diagnostic dimensions (recognition / goal_calibration / surprise / trust / tangibility / voice) and the wow_score scoring instructions
   - The "Return strictly the structured output" closing line
   - The voice rules, banned phrases section, response-under-evaluation framing

   Each mutation should change ONE thing: a sub-score's scoring criterion, the wow_score blend guidance, a new sub-rule, or a clarification of an existing dimension. Keep edits attributable.

   For each mutation provide:
     - **id**: short kebab-case name (e.g. "merchant-time-signal-bonus")
     - **rationale**: why this should fix the cluster
     - **predicted_effect**: which dimension you expect to move and in which direction
     - **new_prompt_body**: the FULL text of the new buildPrompt return value. The script will splice this into a copy of the champion file, replacing only the function body inside buildPrompt. So return the complete template-literal contents starting with "You are calibrating..." through the final "Return strictly the structured output." line. Use \\\${...} for any embedded variables that the existing buildPrompt uses (merchantHint, input.user_brief, etc.) — match the existing variable names exactly.

Constraints:
- Mutations must change the prompt only, not the schema or scoring extraction.
- Each mutation should be a separate concrete change (not bundled).
- If you can't find a clear pattern, return 1 mutation with id "no-clear-pattern" and rationale explaining why — diagnose will respect that.`
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + `…[truncated ${s.length - max} chars]`
}

// ── Materialise candidate files ──────────────────────────────────────────────
// Splice the new_prompt_body into a copy of the champion source. The champion
// source has a function `buildPrompt(input)` whose body is `return \`...\``.
// We locate the template-literal return and replace its contents.

function spliceNewPrompt(championSource: string, newPromptBody: string): string {
  // Heuristic: find `function buildPrompt(input: JudgeInput): string {` and
  // the FIRST `return \`` after it. Replace the template literal up to the
  // matching closing backtick before `\n}`.
  const fnIdx = championSource.indexOf('function buildPrompt(')
  if (fnIdx === -1) {
    throw new Error('spliceNewPrompt: champion source has no `function buildPrompt(`')
  }
  const returnIdx = championSource.indexOf('return `', fnIdx)
  if (returnIdx === -1) {
    throw new Error('spliceNewPrompt: champion source has no `return \\`` after buildPrompt')
  }
  // The closing backtick is the next ` followed by \n} on its own line.
  const closeRe = /`\s*\n\s*}/g
  closeRe.lastIndex = returnIdx + 'return `'.length
  const closeMatch = closeRe.exec(championSource)
  if (!closeMatch) {
    throw new Error('spliceNewPrompt: could not locate closing backtick of buildPrompt return')
  }
  const before = championSource.slice(0, returnIdx + 'return `'.length)
  const after = championSource.slice(closeMatch.index)
  return `${before}${newPromptBody}${after}`
}

function updateJudgeId(source: string, newId: string): string {
  // Replace `export const judgeId = '...'` with the new id.
  const re = /export\s+const\s+judgeId\s*=\s*['"][^'"]*['"]/
  if (!re.test(source)) {
    throw new Error('updateJudgeId: no `export const judgeId = "..."` found')
  }
  return source.replace(re, `export const judgeId = '${newId}'`)
}

// ── Build report ─────────────────────────────────────────────────────────────

interface ReportInput {
  judgeId: string
  cluster_summary: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mutations: Array<{ id: string; rationale: string; predicted_effect: string; new_prompt_body: string }>
  disagreements: DisagreementRow[]
}

function buildReportMd(input: ReportInput): string {
  const lines: string[] = []
  lines.push(`# Diagnose — ${input.judgeId}`)
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push('')
  lines.push('## Cluster summary')
  lines.push('')
  lines.push(input.cluster_summary)
  lines.push('')
  lines.push(`## Proposed mutations (${input.mutations.length})`)
  lines.push('')
  for (const m of input.mutations) {
    lines.push(`### \`${m.id}\``)
    lines.push('')
    lines.push(`**Rationale.** ${m.rationale}`)
    lines.push('')
    lines.push(`**Predicted effect.** ${m.predicted_effect}`)
    lines.push('')
    lines.push('Candidate written to:')
    lines.push(`\`eval/judges/candidates/${m.id}.ts\``)
    lines.push('')
  }
  lines.push('## Disagreement set used')
  lines.push('')
  lines.push(`${input.disagreements.length} pairs where the champion picked opposing to Lewis.`)
  for (const d of input.disagreements) {
    lines.push(`- \`${d.pair_id.slice(0, 8)}\` fold=${d.fold} lewis=${d.lewis_winner} judge=${d.judge_winner}`)
  }
  return lines.join('\n')
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const judge: JudgeModule = JUDGE_FILE ? await loadJudge(JUDGE_FILE) : await loadChampion()
  console.log(`Diagnosing judge: ${judge.judgeId}\n`)

  // Load all rated pairs + the judge's predictions on them (use cache).
  const rated = listPairs({ rated: true })
  if (rated.length === 0) {
    console.error('No rated pairs in the golden set. Run rate.ts first.')
    process.exit(1)
  }

  const disagreements: DisagreementRow[] = []
  for (const pair of rated) {
    if (!pair.rating) continue
    const pred: JudgePrediction | null = findCachedPrediction(pair, judge.judgeId)
    if (!pred) {
      console.error(
        `Pair ${pair.pair_id} has no cached prediction for judge ${judge.judgeId}. ` +
        `Run calibrate.ts first to populate predictions.`,
      )
      process.exit(1)
    }
    // Disagreement: opposing picks, no tie on either side.
    if (pair.rating.winner === pred.predicted_winner) continue
    if (pair.rating.winner === 'tie' || pred.predicted_winner === 'tie') continue
    disagreements.push({
      pair_id: pair.pair_id,
      fold: pair.fold,
      lewis_winner: pair.rating.winner,
      judge_winner: pred.predicted_winner,
      response_a_text: pair.responses.a.text,
      response_b_text: pair.responses.b.text,
      judge_score_a: pred.score_a,
      judge_score_b: pred.score_b,
      reasoning_a: pred.reasoning_a,
      reasoning_b: pred.reasoning_b,
      user_brief: pair.input.user_brief,
    })
  }

  if (disagreements.length === 0) {
    console.log('No clean disagreements between champion and Lewis. No mutations to propose.')
    process.exit(0)
  }
  console.log(`${disagreements.length} disagreement${disagreements.length === 1 ? '' : 's'} found.\n`)

  // Read champion source + constitution
  const championFile = readFileSync(
    join(judgesDir(), readChampionFilename()),
    'utf-8',
  )
  const constitution = existsSync(constitutionPath())
    ? readFileSync(constitutionPath(), 'utf-8')
    : '(Constitution file not found at repo root; meta-judge will rely on judgement.)'

  // Call meta-judge
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require avoids eagerly loading the AI provider in this dev CLI
  const { chatModel } = require('../../src/lib/ai/provider')
  const prompt = buildMetaPrompt({
    championSource: championFile,
    constitution,
    disagreements,
    maxMutations: MAX_MUTATIONS,
  })

  console.log('Calling meta-judge (Sonnet)…\n')
  const { object } = await generateObject({
    model: chatModel,
    schema: MetaJudgeSchema,
    prompt,
  })

  console.log(`Cluster: ${object.cluster_summary}\n`)
  console.log(`Proposed ${object.mutations.length} mutation${object.mutations.length === 1 ? '' : 's'}:`)
  for (const m of object.mutations) {
    console.log(`  - ${m.id}: ${m.predicted_effect}`)
  }

  // Materialise each mutation as a candidate file
  mkdirSync(candidatesDir(), { recursive: true })
  for (const m of object.mutations) {
    if (m.id === 'no-clear-pattern') {
      console.log('\nMeta-judge reported no clear pattern — no candidate written.')
      continue
    }
    const candidateSource = updateJudgeId(
      spliceNewPrompt(championFile, m.new_prompt_body),
      `cand-${m.id}`,
    )
    const candidatePath = join(candidatesDir(), `cand-${m.id}.ts`)
    writeFileSync(candidatePath, candidateSource, 'utf-8')
    console.log(`  wrote: ${candidatePath}`)
  }

  // Write report
  mkdirSync(reportsDir(), { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = join(reportsDir(), `${ts}-diagnose.md`)
  writeFileSync(
    reportPath,
    buildReportMd({
      judgeId: judge.judgeId,
      cluster_summary: object.cluster_summary,
      mutations: object.mutations,
      disagreements,
    }),
    'utf-8',
  )
  console.log(`\nReport: ${reportPath}\n`)
}

// re-export from judge-runner to keep the import shallow
function readChampionFilename(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require keeps the import shallow (re-export from judge-runner)
  const { readChampionFilename: r } = require('./_lib/judge-runner')
  return r()
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
