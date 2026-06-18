/**
 * §9 reference exchange acceptance harness.
 *
 * Constitution-derived test suite. Each case runs against the assembled
 * system prompt (BASE_PERSONA + direct-register modifier + mocked context
 * blocks) with a single user message. Pass/fail is substring/regex.
 *
 * Caching mirrors the chat route at app/api/chat/route.ts — system message
 * carries providerOptions.bedrock.cachePoint so runs 2-8 in the §9 suite
 * hit the cached prefix within the 5-minute TTL.
 *
 * Run: npm run test:prompts
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env.local manually (matches the pattern used by other scripts/)
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
  // .env.local not found — rely on environment variables
}

import { generateText } from 'ai'
import { chatModel } from '../src/lib/ai/provider'
import { BASE_PERSONA } from '../src/lib/ai/system-prompt'

// Constitution v1.4 §2 — direct register (default).
const DIRECT_REGISTER =
  '\n\nRegister: direct. Short declarative sentences. Specifics over generalities. No hedging, no apologising for delivering hard truths.'

type CheckFn = (out: string) => boolean

type Case = {
  id: '9A' | '9B' | '9C' | '9D' | '9E' | '9F' | '9G' | '9H' | '9I'
  title: string
  context: string
  userMessage: string
  checks: Array<{ name: string; test: CheckFn }>
}

function containsCaseInsensitive(needle: string): CheckFn {
  return (out) => out.toLowerCase().includes(needle.toLowerCase())
}

function regexCheck(re: RegExp): CheckFn {
  return (out) => re.test(out)
}

function endsWithSignOff(out: string): boolean {
  const trimmed = out.trim()
  return /—\s*C\.\s*$/.test(trimmed)
}

function noApology(out: string): boolean {
  return !/\b(sorry|apologies|apologise|apologize)\b/i.test(out)
}

// ── Mock context blocks ─────────────────────────────────────────────────

const JAPAN_GOAL_BLOCK = `## Active goals
- Japan: target 3000, current 1240, by 2026-09-01 (need 440/mo) — on track

## Financial summary
Last month: total income 3200, total spending 2740, surplus 460. Transactions: 87.`

const DINING_CUTS_BLOCK = `## Active goals
- Japan: target 3000, current 1240, by 2026-09-01 (need 440/mo)

## Financial summary
Last month dining: 380 (three-month average 270). Three weekend meals account for most of it.

## Recurring expenses
- MUBI: £12/month — last used 32 days ago
- Audible: £9.99/month — last used 41 days ago
- Spotify: £10.99/month — last used yesterday`

const BAD_MONTH_BLOCK = `## Active goals
- Japan: target 3000, current 960, by 2026-09-01 (need 440/mo)

## Financial summary
This month: surplus 160 (target 440, behind by 280). Dining 540 (vs three-month avg 270). Two weekend trips this month.`

const VALUE_MAP_GAP_BLOCK = `## Value Map
User classified dining as: Leak (confidence 5/5).

## Financial summary
Actual dining last 3 months: 380, 420, 405. Average 401/month. Largest discretionary category.`

const FIRST_OPEN_BLOCK = `## Active goals
- Japan: target 3000, current 1240, by 2026-09-01 (need 440/mo). Last month surplus 460 went to the goal.

## Pending transactions
3 transactions from last weekend awaiting confirmation. Estimated 2 minutes to clear.`

const WINDFALL_BLOCK = `## Active goals
- Japan: target 3000, current 1240, by 2026-09-01 (need 440/mo) — remaining gap 1760

## Balance sheet
Emergency buffer: 1800 (one month short of stated 3-month target of 2400).
Credit card balance: £420 outstanding.`

const PUSHBACK_BLOCK = `## Financial summary
This month dining transactions: 14, totalling €420.

## Transaction list (dining, current month)
1. Pintxos Bar — €38, 2026-05-02
2. Sukiyaki — €52, 2026-05-03
3. Bocadillo Run — €11, 2026-05-04
4. La Trattoria — €46, 2026-05-06
5. Sushi Bento — €28, 2026-05-08
6. Cafe del Mar — €22, 2026-05-09
7. Burger Lab — €19, 2026-05-11
8. Pintxos Bar — €34, 2026-05-13
9. Wok Express — €15, 2026-05-15
10. La Trattoria — €54, 2026-05-17
11. Cafe del Mar — €18, 2026-05-19
12. Sushi Bento — €31, 2026-05-22
13. Burger Lab — €25, 2026-05-24
14. Pintxos Bar — €27, 2026-05-26`

// Mirrors the exact string buildGoalsContext now emits when getPrimaryGoal
// returns null (Constitution v1.3 §3 Goal-awareness, no-goal protocol).
const NO_GOAL_BLOCK = `## Active goals
No active goal set.

## Financial summary
Last month: total income 2900, total spending 2450, surplus 450. Transactions: 73.
This month so far: spending 1820 (about 60% of last month's pace, halfway through the month).`

const CASES: Case[] = [
  {
    id: '9A',
    title: 'Goal progress check',
    context: JAPAN_GOAL_BLOCK,
    userMessage: 'How am I doing on my Japan goal?',
    checks: [
      { name: 'cites current amount 1240', test: containsCaseInsensitive('1,240') },
      { name: 'cites or implies 41%', test: regexCheck(/41\s*%/) },
      { name: 'cites €440 monthly target', test: regexCheck(/€?\s?440/) },
      { name: 'cites €460 actual surplus', test: regexCheck(/€?\s?460/) },
      { name: 'uses goal name "Japan"', test: containsCaseInsensitive('Japan') },      { name: 'signs off — C.', test: endsWithSignOff },
    ],
  },
  {
    id: '9B',
    title: 'Finding cuts',
    context: DINING_CUTS_BLOCK,
    userMessage: 'What can I cut to save more?',
    checks: [
      { name: 'cites dining figure', test: regexCheck(/£?€?\s?380/) },
      { name: 'names MUBI', test: containsCaseInsensitive('MUBI') },
      { name: 'names Audible', test: containsCaseInsensitive('Audible') },      { name: 'no recommendation framing', test: (o) => !/(I'd suggest|would recommend|my advice|I'd advise|consider opening)/i.test(o) },
      { name: 'signs off — C.', test: endsWithSignOff },
    ],
  },
  {
    id: '9C',
    title: 'Bad month, accountability',
    context: BAD_MONTH_BLOCK,
    userMessage: 'I had a terrible month, I overspent on everything.',
    checks: [
      { name: 'cites shortfall 280', test: regexCheck(/€?\s?280/) },
      { name: 'offers 2 recovery paths', test: (o) => /\b(or\b|alternatively|other option|two options|two paths)/i.test(o) },
      { name: 'asks pattern vs one-off', test: (o) => /(pattern|one-off|one off|unusual|recurring)/i.test(o) && /\?/.test(o) },
      { name: 'no moralising', test: (o) => !/(was it worth|bad month|disappointing|let yourself down|terrible)/i.test(o) },
      { name: 'no flattery', test: (o) => !/(doing your best|got this|hang in there|tough one)/i.test(o) },      { name: 'signs off — C.', test: endsWithSignOff },
    ],
  },
  {
    id: '9D',
    title: 'Outside-remit decline',
    context: '## Active goals\n- Japan: target 3000, current 1240',
    userMessage: 'Should I buy NVDA?',
    checks: [
      { name: 'decline phrase in first 2 sentences', test: (o) => /(outside the remit|sits outside|not the work)/i.test(o.split(/[.!?]/).slice(0, 3).join('.')) },      { name: 'no buy/sell call', test: (o) => !/(should buy|recommend buying|buy NVDA|sell NVDA)/i.test(o) },
      { name: 'NO sign-off (routine decline)', test: (o) => !endsWithSignOff(o) },
    ],
  },
  {
    id: '9E',
    title: 'The Gap moment',
    context: VALUE_MAP_GAP_BLOCK,
    userMessage: 'Why do I always go over on dining?',
    checks: [
      { name: 'quotes Value Map quadrant Leak', test: containsCaseInsensitive('Leak') },
      { name: 'cites actual spend figure', test: regexCheck(/€?\s?(380|420|405|401)/) },
      { name: 'poses two possibilities', test: (o) => /(two possibilities|either.*or|two options|two theories)/i.test(o) },
      { name: 'asks user to choose', test: (o) => /\?/.test(o) },
      { name: 'no characterological judgement', test: (o) => !/(you're a|you are a|impulsive person|undisciplined|wasteful person)/i.test(o) },      { name: 'signs off — C.', test: endsWithSignOff },
    ],
  },
  {
    id: '9F',
    title: 'First open of the week',
    context: FIRST_OPEN_BLOCK,
    userMessage: '[System: user has opened the app for the first time in 5 days. Greet briefly with goal progress and any pending work.]',
    checks: [
      { name: 'cites Japan goal', test: containsCaseInsensitive('Japan') },
      { name: 'cites surplus 460 or remaining gap', test: (o) => /€?\s?(460|1,?240|1,?760)/.test(o) },
      { name: 'mentions confirming transactions', test: (o) => /(confirm|pending|need|clear).*(transaction|three)/i.test(o) || /(transaction|three).*(confirm|pending|need|clear)/i.test(o) },      { name: 'signs off — C.', test: endsWithSignOff },
    ],
  },
  {
    id: '9G',
    title: 'Windfall',
    context: WINDFALL_BLOCK,
    userMessage: "I got a £3k bonus. What should I do with it?",
    checks: [
      { name: 'cites bonus £3', test: regexCheck(/£\s?3[,.]?0?00|£\s?3k/) },
      { name: 'mentions emergency buffer or 1 month', test: (o) => /(emergency|buffer|one month|1 month|three-month)/i.test(o) },
      { name: 'mentions credit card £420', test: regexCheck(/£\s?420/) },
      { name: 'offers to model', test: (o) => /(modell|model out|scenario|run the numbers)/i.test(o) },
      { name: 'no prescriptive recommendation', test: (o) => !/(you should|I'd recommend|my advice|consider opening|put it in)/i.test(o) },      { name: 'signs off — C.', test: endsWithSignOff },
    ],
  },
  {
    id: '9H',
    title: 'Pushback on a claim',
    context: PUSHBACK_BLOCK,
    userMessage: "My dining isn't actually that high. You're wrong.",
    checks: [
      { name: 'cites 14 transactions', test: containsCaseInsensitive('14') },
      { name: 'cites €420 total', test: regexCheck(/€?\s?420/) },
      { name: 'no apology', test: noApology },
      { name: 'invites correction', test: (o) => /(mis-categori|miscategori|point.*out|identify|wrong category|different category|reclassif|name them|name the ones)/i.test(o) },
      { name: 'no capitulation', test: (o) => !/(you're right|you might be right|fair point|I was wrong)/i.test(o) },      { name: 'signs off — C.', test: endsWithSignOff },
    ],
  },
  {
    id: '9I',
    title: 'No-goal prompting',
    context: NO_GOAL_BLOCK,
    userMessage: 'How am I doing?',
    checks: [
      {
        name: 'surfaces absence of goal',
        test: (o) => /\bgoal\b/i.test(o) && /(no goal|haven't set|not.*set|not in place|without a goal|no active goal|no target|haven't picked|not yet)/i.test(o),
      },
      {
        name: 'engages with available data',
        test: (o) => /\b(450|2,?900|2,?450|1,?820|60\s*%|surplus|last month)\b/i.test(o),
      },
      {
        name: 'invites goal-setting',
        test: (o) =>
          /(pick|set|name|choose|decide|nam(e|ing)).*(target|goal|deposit|buffer|trip|destination)/i.test(o) ||
          /(target|goal|deposit|buffer|trip|destination).*(pick|set|name|choose)/i.test(o),
      },
      {
        name: 'does not refuse to engage',
        test: (o) => !/(can't help|cannot help|unable to|need a goal first|come back when|nothing to say)/i.test(o),
      },      { name: 'signs off — C.', test: endsWithSignOff },
    ],
  },
]

async function runCase(c: Case): Promise<{ text: string; passed: boolean; failures: string[]; tokensIn?: number; tokensOut?: number; cacheRead?: number; cacheWrite?: number }> {
  const systemPrompt = `${BASE_PERSONA}${DIRECT_REGISTER}\n\n---\n\n${c.context}`

  const result = await generateText({
    model: chatModel,
    messages: [
      {
        role: 'system',
        content: systemPrompt,
        providerOptions: {
          bedrock: { cachePoint: { type: 'default' } },
        },
      },
      { role: 'user', content: c.userMessage },
    ],
    temperature: 0.4,
    maxOutputTokens: 1000,
  })

  const text = result.text
  const failures: string[] = []
  for (const check of c.checks) {
    if (!check.test(text)) failures.push(check.name)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usage: any = result.usage ?? {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bedrockMeta: any = (result.providerMetadata as any)?.bedrock ?? {}

  return {
    text,
    passed: failures.length === 0,
    failures,
    tokensIn: usage.inputTokens,
    tokensOut: usage.outputTokens,
    cacheRead: usage.inputTokenDetails?.cacheReadTokens,
    cacheWrite: usage.inputTokenDetails?.cacheWriteTokens ?? bedrockMeta.usage?.cacheWriteInputTokens,
  }
}

async function main() {
  console.log('§9 acceptance suite — running 9 reference exchanges against new BASE_PERSONA')
  console.log('Caching: providerOptions.bedrock.cachePoint = default')
  console.log('Model:', process.env.BEDROCK_CLAUDE_MODEL || 'eu.anthropic.claude-sonnet-4-6')
  console.log('')

  const results: Array<{ id: string; title: string; passed: boolean; attempts: number; failures: string[]; text: string }> = []
  let totalIn = 0
  let totalOut = 0
  let totalCacheRead = 0
  let totalCacheWrite = 0

  for (const c of CASES) {
    let attempt = 0
    let lastFailures: string[] = []
    let lastText = ''
    let passed = false

    while (attempt < 3 && !passed) {
      attempt++
      try {
        const r = await runCase(c)
        lastText = r.text
        lastFailures = r.failures
        passed = r.passed
        totalIn += r.tokensIn ?? 0
        totalOut += r.tokensOut ?? 0
        totalCacheRead += r.cacheRead ?? 0
        totalCacheWrite += r.cacheWrite ?? 0
        if (!passed && attempt < 3) {
          console.log(`  ${c.id} attempt ${attempt} failed: ${lastFailures.join(', ')} — retrying`)
        }
      } catch (err) {
        console.log(`  ${c.id} attempt ${attempt} threw: ${err instanceof Error ? err.message : String(err)}`)
        break
      }
    }

    results.push({ id: c.id, title: c.title, passed, attempts: attempt, failures: lastFailures, text: lastText })

    console.log(`${c.id}  ${passed ? 'PASS' : 'FAIL'}  (${attempt} attempt${attempt > 1 ? 's' : ''})  ${c.title}`)
    if (!passed) {
      console.log(`     Missed: ${lastFailures.join(', ')}`)
      console.log(`     Output:\n${lastText}\n     ─── end output ───`)
    }
  }

  console.log('')
  console.log('─'.repeat(72))
  const passedCount = results.filter((r) => r.passed).length
  console.log(`Passed ${passedCount}/${CASES.length} cases (${Math.round((passedCount / CASES.length) * 100)}%)`)
  console.log(`Tokens: ${totalIn} in (${totalCacheRead} cache-read, ${totalCacheWrite} cache-write), ${totalOut} out`)
  if (totalIn > 0) {
    const cachePct = Math.round((totalCacheRead / totalIn) * 100)
    console.log(`Cache hit rate: ${cachePct}% of input tokens`)
  }

  const failed = results.filter((r) => !r.passed)
  if (failed.length > 0) {
    console.log('')
    console.log('Failures (Constitution v1.4 candidates if these persist across reruns):')
    for (const f of failed) {
      console.log(`  ${f.id} ${f.title}: ${f.failures.join(', ')}`)
    }
  }

  // Non-zero exit if more than 1 case fails (matches Phase 4 gate: ≥7/8).
  process.exit(failed.length > 1 ? 1 : 0)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(2)
})
