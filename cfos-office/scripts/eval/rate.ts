#!/usr/bin/env tsx
// Interactive CLI for rating golden-set pairs.
//
//   npx tsx scripts/eval/rate.ts [--fresh-only] [--limit N] [--rater <name>]
//
// Walks unrated pairs in eval/golden-set/pairs/. For each:
//   - Shows persona / brief / trigger
//   - Renders response A and B sequentially with shuffled position (so Lewis
//     doesn't anchor on "v1 always shown first")
//   - Prompts for verdict: a / b / tie / s=skip / q=quit / ?=re-show
//   - Optional 1-line note
//   - Writes back via applyRating
//
// Position randomisation note: a pair stored as (v1, v2) gets shown either
// as (v1, v2) or (v2, v1). Lewis picks "left" or "right". We map back to the
// original (a, b) labels before writing the rating.

import { createInterface, type Interface as ReadlineInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { applyRating, listPairs, type GoldenPair, type Winner } from './_lib/pair-storage'

// ── Args ─────────────────────────────────────────────────────────────────────

const ARGV = process.argv.slice(2)
const FRESH_ONLY = ARGV.includes('--fresh-only')

function consumeFlagValue(name: string, fallback: string | null = null): string | null {
  const idx = ARGV.findIndex((a) => a === name || a.startsWith(`${name}=`))
  if (idx === -1) return fallback
  const v = ARGV[idx]
  if (v.includes('=')) return v.split('=').slice(1).join('=')
  return ARGV[idx + 1] ?? fallback
}

const LIMIT = Number(consumeFlagValue('--limit', '999') ?? 999)
const RATER = consumeFlagValue('--rater', 'lewis') ?? 'lewis'

// ── Display helpers ──────────────────────────────────────────────────────────

const SEP_THICK = '═'.repeat(72)
const SEP_THIN = '─'.repeat(72)

function colour(s: string, code: string): string {
  if (!stdout.isTTY) return s
  return `\x1b[${code}m${s}\x1b[0m`
}
const dim = (s: string) => colour(s, '2')
const bold = (s: string) => colour(s, '1')
const cyan = (s: string) => colour(s, '36')
const yellow = (s: string) => colour(s, '33')
const green = (s: string) => colour(s, '32')

function renderPair(pair: GoldenPair, leftLabel: 'a' | 'b'): string {
  // leftLabel = which underlying side is being shown FIRST. The other side
  // is shown second. We always label them as LEFT / RIGHT to Lewis to avoid
  // anchoring on the variant labels.
  const rightLabel: 'a' | 'b' = leftLabel === 'a' ? 'b' : 'a'
  const left = pair.responses[leftLabel]
  const right = pair.responses[rightLabel]

  const header = [
    SEP_THICK,
    `${bold('PAIR')} ${pair.pair_id}    ${dim(`fold=${pair.fold}  source=${pair.source}`)}`,
    pair.input.persona_id ? `${dim('persona:')} ${pair.input.persona_id}` : '',
    `${dim('brief:')} ${pair.input.user_brief.replace(/\n/g, ' | ').slice(0, 180)}`,
    `${dim('trigger:')} ${pair.input.trigger_message.slice(0, 120)}`,
    SEP_THIN,
  ].filter(Boolean).join('\n')

  return [
    header,
    cyan(bold('LEFT  ──────────────────────────────────────────────────────────────────')),
    left.text,
    '',
    yellow(bold('RIGHT ──────────────────────────────────────────────────────────────────')),
    right.text,
    SEP_THIN,
  ].join('\n')
}

// ── Verdict mapping ──────────────────────────────────────────────────────────
// Lewis says left / right / tie. We map back to (a, b, tie) based on the
// random ordering we presented.

function leftRightToWinner(verdict: 'left' | 'right' | 'tie', leftLabel: 'a' | 'b'): Winner {
  if (verdict === 'tie') return 'tie'
  if (verdict === 'left') return leftLabel
  return leftLabel === 'a' ? 'b' : 'a'
}

// ── Prompt loop ──────────────────────────────────────────────────────────────

interface PromptResult {
  action: 'rated' | 'skip' | 'quit' | 'reshow'
  winner?: Winner
  notes?: string | null
}

const VERDICT_HINT = `\n${dim('[L]eft / [R]ight / [T]ie  |  [S]kip  |  [Q]uit  |  [?] re-show')}\n${bold('Verdict:')} `

async function promptForVerdict(
  rl: ReadlineInterface,
  pair: GoldenPair,
  leftLabel: 'a' | 'b',
): Promise<PromptResult> {
  while (true) {
    const ans = (await rl.question(VERDICT_HINT)).trim().toLowerCase()
    if (!ans) continue
    const c = ans[0]
    if (c === 'q') return { action: 'quit' }
    if (c === 's') return { action: 'skip' }
    if (c === '?') return { action: 'reshow' }
    if (c === 'l') {
      const notes = await promptForNotes(rl)
      return { action: 'rated', winner: leftRightToWinner('left', leftLabel), notes }
    }
    if (c === 'r') {
      const notes = await promptForNotes(rl)
      return { action: 'rated', winner: leftRightToWinner('right', leftLabel), notes }
    }
    if (c === 't') {
      const notes = await promptForNotes(rl)
      return { action: 'rated', winner: 'tie', notes }
    }
    console.log(dim(`Unrecognised: "${ans}". Try L/R/T/S/Q/?.`))
    void pair  // keep arg used
  }
}

async function promptForNotes(rl: ReadlineInterface): Promise<string | null> {
  const ans = (await rl.question(`${dim('Note (optional, enter to skip):')} `)).trim()
  return ans ? ans : null
}

// ── Position randomisation ───────────────────────────────────────────────────
// Deterministic per pair so re-runs of the same pair show the same order
// (lets Lewis come back to a skipped pair without disorientation).

function leftSideFor(pair: GoldenPair): 'a' | 'b' {
  // Use the first hex digit of the pair_id as a coin flip.
  const c = pair.pair_id[0]?.toLowerCase() ?? '0'
  const isHexUpper = '0123456789abcdef'.indexOf(c) >= 8
  return isHexUpper ? 'b' : 'a'
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const unrated = listPairs({ rated: false })
  if (unrated.length === 0) {
    console.log(green('No unrated pairs in the golden set. Nothing to do.'))
    return
  }

  console.log(bold(`\n${unrated.length} unrated pair${unrated.length === 1 ? '' : 's'} found.`))
  if (FRESH_ONLY) {
    // Future filter — currently no-op (we already listed unrated). Reserved
    // for "rated within the last N days" / "captured today" filters.
  }
  console.log(dim(`Rating as: ${RATER}.  Limit: ${LIMIT}.  Type ? at any verdict to re-show.\n`))

  const rl = createInterface({ input: stdin, output: stdout })
  let rated = 0
  let skipped = 0
  try {
    for (const pair of unrated.slice(0, LIMIT)) {
      const leftLabel = leftSideFor(pair)
      const render = renderPair(pair, leftLabel)
      console.log(render)

      // Inner reshow loop — Lewis can hit ? to re-render.
      let result: PromptResult
      while (true) {
        result = await promptForVerdict(rl, pair, leftLabel)
        if (result.action !== 'reshow') break
        console.log(render)
      }

      if (result.action === 'quit') {
        console.log(dim('\nQuit.'))
        break
      }
      if (result.action === 'skip') {
        skipped++
        console.log(dim('skipped.\n'))
        continue
      }
      if (result.action === 'rated' && result.winner) {
        applyRating(pair.pair_id, {
          winner: result.winner,
          rater: RATER,
          rated_at: new Date().toISOString(),
          notes: result.notes ?? null,
        })
        rated++
        console.log(green(`  ✓ winner=${result.winner}\n`))
      }
    }
  } finally {
    rl.close()
  }

  console.log(SEP_THICK)
  console.log(`Done. Rated ${rated}, skipped ${skipped}.`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
