/**
 * First-Read A/B pair producer.
 *
 * eval/README.md has always told you to seed the golden set with this script.
 * It was never in the repo — the eight stored pairs came from a branch that
 * didn't land, which left the whole rating/calibration pipeline downstream of a
 * missing input. This is that producer, rebuilt.
 *
 * WHAT IT TESTS (default arms)
 *
 * Every First Read system prompt carries this line:
 *
 *   "VOICE — Read-format constraints only (full voice lives in
 *    CFO-CONSTITUTION.md §2; do not restate it here)"
 *
 * but the composer ships that prompt and nothing else — `generateText({ system:
 * systemPrompt })` in compose-first-read.ts. BASE_PERSONA never reaches it. So
 * the Read is written by a model pointed at a voice document it cannot see,
 * while the chat turn immediately after it *does* get BASE_PERSONA. Two
 * writers, one handoff — a plausible mechanical cause of a Read that is hard to
 * resonate with.
 *
 *   arm A  'no-persona'    the composer prompt exactly as shipped
 *   arm B  'base-persona'  BASE_PERSONA + the same composer prompt
 *
 * Note which way the size runs: arm B is the BIGGER prompt. If it wins, "too
 * much system prompt" is the wrong diagnosis for the Read — it had too little.
 * That makes this an honest test of the hypothesis, not a confirmation of it.
 *
 * WHY THE DECLARED PATH
 *
 * Declared mode needs only income, fixed costs and a goal, so the fact package
 * is built by the production builders (`buildDeclaredFacts` →
 * `buildDeclaredUserPrompt`) from persona fixtures with nothing invented. The
 * transaction paths would need a fabricated value profile and cluster set, and
 * a made-up user prompt would put the realism of the input in question rather
 * than the difference between the arms.
 *
 * Both arms get the byte-identical user prompt. The system prompt is the only
 * variable.
 *
 * Run:
 *   npx tsx scripts/compare-first-insight.ts --dry-run          # no Bedrock spend
 *   npx tsx scripts/compare-first-insight.ts --personas=zane-spain --n=2
 *   npx tsx scripts/compare-first-insight.ts                    # all personas, 1 each
 *
 * Then rate them blind (position is randomised by the rater):
 *   npx tsx scripts/eval/rate.ts
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env.local manually (matches the pattern used by other scripts/).
try {
  const envFile = readFileSync(resolve(__dirname, '../.env.local'), 'utf-8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim()
    if (!process.env[key]) process.env[key] = value
  }
} catch {
  // .env.local not found — rely on environment variables.
}

import { generateText } from 'ai'
import { bedrock, composeModelId } from '../src/lib/ai/provider'
import { BASE_PERSONA } from '../src/lib/ai/system-prompt'
import {
  FIRST_READ_SYSTEM_PROMPT_DECLARED,
  buildDeclaredUserPrompt,
} from '../src/lib/ai/prompts/first-read'
import {
  buildDeclaredFacts,
  DECLARED_MAX_OUTPUT_TOKENS,
  type DeclaredReadFacts,
} from '../src/lib/ai/compose-first-read'
import { PERSONAS, getPersona } from '../tests/onboarding/personas'
import type { Persona } from '../tests/onboarding/personas/types'
import { buildPair, writePair, hashPrompt, type ResponseRecord } from './eval/_lib/pair-storage'

// Production compose settings, mirrored so a pair is rated on what the shipped
// path would actually have produced (compose-first-read.ts).
const TEMPERATURE = 0.5
const TIMEOUT_MS = 20_000

interface Arm {
  label: string
  systemPrompt: string
}

/**
 * Arm B appends no register. The three registers are a chat-surface concern —
 * the composer has no advice_style plumbing at all — so adding one would test
 * two changes at once and invent a fourth copy of a string that already lives
 * in context-builder.
 */
function buildArms(): { a: Arm; b: Arm } {
  return {
    a: { label: 'no-persona', systemPrompt: FIRST_READ_SYSTEM_PROMPT_DECLARED },
    b: {
      label: 'base-persona',
      systemPrompt: `${BASE_PERSONA}\n\n${FIRST_READ_SYSTEM_PROMPT_DECLARED}`,
    },
  }
}

/**
 * Declared-mode facts for a persona, through the production builder.
 *
 * `totalFixedCosts` is the persona's rent: a declared-mode user has skipped the
 * upload, so the only costs on file are the ones the essentials beat collected.
 * Inflating it with CSV-derived recurring lines would describe a user who
 * uploaded — the wrong scenario for this path.
 */
function factsForPersona(persona: Persona): DeclaredReadFacts | null {
  const { monthlyIncome, monthlyRent, currency } = persona.profile
  if (monthlyIncome == null || monthlyRent == null) return null

  const goal = persona.expectations.goal
  return buildDeclaredFacts({
    income: monthlyIncome,
    totalFixedCosts: monthlyRent,
    currency,
    goal: goal
      ? {
          name: goal.name,
          // Personas carry no stored pace; buildDeclaredFacts derives the
          // straight-line one from target and date exactly as production does.
          monthlyRequiredSaving: null,
          targetAmount: goal.targetAmount,
          currentAmount: goal.currentAmount ?? null,
          targetDate: goal.targetDate ?? null,
          type: goal.type ?? null,
        }
      : null,
  })
}

function briefFor(persona: Persona, facts: DeclaredReadFacts): string {
  const goal = facts.goalName ? `goal "${facts.goalName}"` : 'no goal set'
  return [
    `${persona.label} (${persona.id}), ${persona.profile.country}, ${facts.currency}.`,
    `Declared income ${facts.income}/mo, declared fixed costs ${facts.totalFixedCosts}/mo,`,
    `free cash ${facts.freeCash}/mo, ${goal}.`,
    'Skip-upload path: no transactions seen.',
  ].join(' ')
}

async function runArm(arm: Arm, userPrompt: string): Promise<ResponseRecord> {
  const result = await generateText({
    model: bedrock(composeModelId),
    system: arm.systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    maxOutputTokens: DECLARED_MAX_OUTPUT_TOKENS,
    temperature: TEMPERATURE,
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
  })
  return {
    text: result.text.trim(),
    // The composer calls no tools; the field exists for the chat-path captures
    // that share this pair format.
    tool_calls: [],
    tokens: { in: result.usage?.inputTokens ?? 0, out: result.usage?.outputTokens ?? 0 },
  }
}

interface Args {
  personaIds: string[]
  n: number
  dryRun: boolean
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`))
    return hit ? hit.slice(name.length + 3) : undefined
  }
  const personasArg = get('personas')
  const nArg = get('n')
  return {
    personaIds: personasArg ? personasArg.split(',').map((s) => s.trim()).filter(Boolean) : [],
    n: nArg ? Math.max(1, parseInt(nArg, 10) || 1) : 1,
    dryRun: argv.includes('--dry-run'),
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  const personas: Persona[] = args.personaIds.length
    ? args.personaIds.map((id) => {
        const p = getPersona(id)
        if (!p) throw new Error(`unknown persona: ${id} (known: ${PERSONAS.map((x) => x.id).join(', ')})`)
        return p
      })
    : [...PERSONAS]

  const arms = buildArms()
  const armAChars = arms.a.systemPrompt.length
  const armBChars = arms.b.systemPrompt.length

  console.log('First-Read A/B — declared path')
  console.log(`  model      ${composeModelId}`)
  console.log(`  arm A      ${arms.a.label}   ${armAChars} chars  (~${Math.round(armAChars / 4)} tok)  ${hashPrompt(arms.a.systemPrompt)}`)
  console.log(`  arm B      ${arms.b.label}  ${armBChars} chars  (~${Math.round(armBChars / 4)} tok)  ${hashPrompt(arms.b.systemPrompt)}`)
  console.log(`  delta      +${armBChars - armAChars} chars on arm B (the persona)`)
  console.log(`  personas   ${personas.length} × ${args.n} = ${personas.length * args.n} pairs`)
  console.log('')

  let written = 0
  let skipped = 0

  for (const persona of personas) {
    const facts = factsForPersona(persona)
    if (!facts) {
      console.log(`  – ${persona.id}: skipped (no declared income/rent on the fixture)`)
      skipped += 1
      continue
    }
    const userPrompt = buildDeclaredUserPrompt(facts)

    if (args.dryRun) {
      console.log(`  – ${persona.id}: user prompt ${userPrompt.length} chars`)
      console.log(`      A total ${armAChars + userPrompt.length} · B total ${armBChars + userPrompt.length} chars`)
      continue
    }

    for (let i = 0; i < args.n; i++) {
      try {
        // Sequential, not parallel: the two arms share a prompt prefix only
        // within an arm, and a burst of concurrent Bedrock calls is the fastest
        // way to get throttled mid-run and lose half a pair.
        const responseA = await runArm(arms.a, userPrompt)
        const responseB = await runArm(arms.b, userPrompt)

        const pair = buildPair({
          source: 'compare-first-insight',
          persona_id: persona.id,
          // No staging user is created — the fixture IS the user. Recorded as
          // the persona id so a pair is traceable without implying a real row.
          user_id: `persona:${persona.id}`,
          trigger_message: userPrompt,
          // Declared mode shows the model no transactions, so there are no
          // merchants it could legitimately name.
          known_merchants: [],
          user_brief: briefFor(persona, facts),
          variant_a: { label: arms.a.label, system_prompt: arms.a.systemPrompt },
          variant_b: { label: arms.b.label, system_prompt: arms.b.systemPrompt },
          response_a: responseA,
          response_b: responseB,
        })
        writePair(pair)
        written += 1
        console.log(
          `  ✓ ${persona.id} #${i + 1} → ${pair.pair_id} (${pair.fold})` +
            `  A ${responseA.tokens.in}/${responseA.tokens.out}` +
            `  B ${responseB.tokens.in}/${responseB.tokens.out}`,
        )
      } catch (err) {
        // One persona failing must not lose the pairs already written.
        console.error(`  ✗ ${persona.id} #${i + 1}: ${(err as Error).message}`)
        skipped += 1
      }
    }
  }

  console.log('')
  if (args.dryRun) {
    console.log('Dry run — no Bedrock calls, no pairs written.')
    return
  }
  console.log(`${written} pair(s) written, ${skipped} skipped.`)
  if (written > 0) console.log('Rate them blind:  npx tsx scripts/eval/rate.ts')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
