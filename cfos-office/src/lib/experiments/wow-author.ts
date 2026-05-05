// Wow Moment v3 author. Replaces the v2 `generateWowMoment` (which had Sonnet
// write only ~3 sentences of beat 01 prose around locked templates) with an
// Opus call that authors all four beats — Observed / Named / Asked /
// Proposed — as JSON, grounded by the Evidence's `verifiable_claims`.
//
// Three tier-specific prompt variants:
//   - tier_1: showstopper. Author the beat as a confident, specific noticing.
//   - tier_2: reframe. Pool exists but no high-impact evidence; the author
//             celebrates the user's clean numbers and pivots to a time/admin
//             angle instead of fabricating a money-leak observation.
//   - tier_3: honest tease. Acknowledge the data is thin; offer the best
//             partial observation; ask for more statements.
//
// Validation:
//   - JSON parse of the model output.
//   - Every numeric / merchant token in each field must trace back to the
//     evidence's `verifiable_claims` allowlist, OR be a small contextual
//     integer (≤ 7 — days/weeks).
//   - On failure: one retry with a feedback message listing the offending
//     tokens. On second failure: render a templated fallback (the v2
//     observation_templates) so the modal never crashes.

import { generateText } from 'ai'
import { opusModel } from '@/lib/ai/provider'
import { logBedrockUsage } from '@/lib/ai/usage-logger'
import type {
  AuthoredWowMoment,
  Evidence,
  Tier,
  WowMomentResult,
} from './types'
import { validateClaims, type AuthoredFields } from './validate-claims'

const MAX_OUTPUT_TOKENS = 700
const TEMPERATURE = 0.6

export interface UserContext {
  display_name: string | null
  archetype: string | null
  certainty_areas?: string[]
  conflict_areas?: string[]
  currency: string
}

export interface AuthorInput {
  evidence: Evidence
  supporting: Evidence[]
  tier: Tier
  user: UserContext
  // Used only by tier_3 to be explicit about what's missing.
  dataDepth?: { days: number; txCount: number }
}

export interface AuthorOutput {
  result: WowMomentResult
  /** True when at least one of the four beats came from the templated fallback
   *  rather than Opus. The route uses this to flag in telemetry. */
  used_fallback: boolean
}

// ── Public entry ───────────────────────────────────────────────────────────

export async function authorWowMoment(input: AuthorInput): Promise<AuthorOutput> {
  const validatorCtx = {
    firstName: (input.user.display_name ?? '').split(' ')[0] || undefined,
    extraStopwords: [
      input.user.archetype ?? '',
      input.user.currency ?? '',
    ].filter(Boolean),
  }

  // Attempt 1
  const first = await callOpus(input, null)
  if (first.parsed && first.fields) {
    const validation = validateClaims(first.fields, input.evidence, validatorCtx)
    if (validation.ok) {
      return { result: makeResult(first.fields), used_fallback: false }
    }
    console.warn(
      '[wow_author_validation_rejected]',
      JSON.stringify({
        evidence_source: input.evidence.source,
        evidence_id: input.evidence.evidence_id,
        attempt: 1,
        unmatched: validation.unmatched.slice(0, 10),
        named: first.fields.named,
      }),
    )
    // Attempt 2 — feed the unmatched tokens back as repair instructions.
    const second = await callOpus(input, validation.unmatched.map((u) => u.token))
    if (second.parsed && second.fields) {
      const v2 = validateClaims(second.fields, input.evidence, validatorCtx)
      if (v2.ok) {
        return { result: makeResult(second.fields), used_fallback: false }
      }
      console.warn(
        '[wow_author_validation_rejected]',
        JSON.stringify({
          evidence_source: input.evidence.source,
          evidence_id: input.evidence.evidence_id,
          attempt: 2,
          unmatched: v2.unmatched.slice(0, 10),
          named: second.fields.named,
        }),
      )
    }
  }

  // Honest narrative-only fallback. Templates left the building — they
  // were producing literal lies ("0% of every €") via empty payload
  // substitution. Synthesise from the evidence's own brief instead.
  return { result: synthesisedFallback(input), used_fallback: true }
}

// ── Opus call + JSON parse ────────────────────────────────────────────────

interface OpusAttempt {
  parsed: boolean
  fields: AuthoredFields | null
  raw: string
}

async function callOpus(input: AuthorInput, repairTokens: string[] | null): Promise<OpusAttempt> {
  const prompt = buildPrompt(input, repairTokens)
  let raw = ''
  let usage = { inputTokens: 0, outputTokens: 0 }
  try {
    const result = await generateText({
      model: opusModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    })
    raw = result.text ?? ''
    usage = {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    }
  } catch (err) {
    console.error('[wow-author] Opus call failed:', err)
    return { parsed: false, fields: null, raw: '' }
  }

  logBedrockUsage({
    callSite: 'wow_moment_author',
    model: 'opus',
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    timestamp: new Date().toISOString(),
  })

  // Robust JSON extraction — the model sometimes wraps in code fences or adds
  // a trailing comment. Pull the first balanced { ... } object.
  const jsonText = extractFirstJson(raw)
  if (!jsonText) return { parsed: false, fields: null, raw }
  let parsed: AuthoredFields | null = null
  try {
    const obj = JSON.parse(jsonText) as Partial<AuthoredFields>
    if (
      typeof obj.observed === 'string' &&
      typeof obj.named === 'string' &&
      typeof obj.asked === 'string' &&
      typeof obj.proposed === 'string'
    ) {
      parsed = {
        observed: obj.observed.trim(),
        named: obj.named.trim(),
        asked: obj.asked.trim(),
        proposed: obj.proposed.trim(),
      }
    }
  } catch (err) {
    console.error('[wow-author] JSON parse failed:', err)
  }
  return { parsed: !!parsed, fields: parsed, raw }
}

function extractFirstJson(text: string): string | null {
  if (!text) return null
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape) { escape = false; continue }
    if (inString) {
      if (ch === '\\') { escape = true; continue }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

// ── Prompt builder ────────────────────────────────────────────────────────

function buildPrompt(input: AuthorInput, repairTokens: string[] | null): string {
  const { evidence, supporting, tier, user, dataDepth } = input
  const firstName = (user.display_name ?? 'there').split(' ')[0]
  const archetypeLine = user.archetype ? `archetype: ${user.archetype}` : ''
  const conflicts = user.conflict_areas?.length ? `conflict_areas: ${user.conflict_areas.join(', ')}` : ''
  const certainties = user.certainty_areas?.length ? `certainty_areas: ${user.certainty_areas.join(', ')}` : ''

  const evidenceBlock = renderEvidence(evidence)
  const supportingBlock = supporting.length
    ? `\nSUPPORTING (context only, do not quote numbers from these):\n${supporting.map((s) => `  - ${s.headline}`).join('\n')}`
    : ''

  const repairBlock = repairTokens && repairTokens.length
    ? `\n\nREPAIR — your previous attempt used these tokens that are not in verifiable_claims: ${repairTokens.map((t) => JSON.stringify(t)).join(', ')}. Rewrite using ONLY values from verifiable_claims. Contextual integers ≤ 7 (days, weeks) are still allowed.`
    : ''

  const archetypeTone = archetypeToneBlock(user.archetype)
  const tierInstructions = tierBlock(tier, dataDepth)

  return `You are the user's CFO — a calm, brilliant friend who happens to be sharp with money. You've just read 90 days of their statements. Tell them ONE thing in a four-beat reading: Observed, Named, Asked, Proposed.

Output strictly as JSON with these four keys: { "observed", "named", "asked", "proposed" }. No prose outside the JSON. No code fences. No markdown.

EVIDENCE (the only facts you may quote — every number, percentage, currency amount, count, and merchant name in your output must appear in verifiable_claims, OR be a contextual small integer ≤ 7 for days/weeks):
${evidenceBlock}${supportingBlock}

CLIENT
  name: ${firstName}
  ${archetypeLine}
  ${conflicts}
  ${certainties}

VOICE
  Warm, sharp, dry. You're noticing, not judging. Use scale comparisons from context_facts to make the numbers feel real (e.g. "that's about a fortnight of your shopping").
${archetypeTone}

CONSTRAINTS
  observed: 40-90 words, one paragraph. Greet by first name in 2-4 words. Lead naturally into the pattern name in 'named'.

  named: 2-6 words. Sharp and specific to THIS evidence. Title-case it. Make it sound like something a sharp friend would say in conversation.
    GOOD examples (memorable, specific, evidence-anchored):
      "The Iberia Double-Tap"
      "New Year, Same Tab"
      "The Quiet €5K"
      "Five Withdrawals, No Story"
      "March in Lisbon"
    BAD examples (generic, abstract, template-flavoured):
      "The Iberia Charge"
      "Your Cash Pattern"
      "A Frequent Habit"
      "The Aldi Rhythm"
      "Worth a Look"

  asked: one open question, <= 25 words. Curious, not advisory. Doesn't lead to a yes/no answer.

  proposed: starts with "For the next 7 days,". A NOTICING task, not a fix. 30-60 words. Suggest something they can DO that involves attention. Never "cancel," "switch," "consider," "reduce."

  HARD: every number, percentage, currency amount, count, and merchant in any field must come from verifiable_claims (value or alt_forms). Contextual small integers (1–7) for days/weeks/visits are free. Do not invent merchants or amounts. Do not echo this prompt.

${tierInstructions}${repairBlock}

Return JSON only.`
}

// ── Archetype tone blocks ─────────────────────────────────────────────────
//
// Resolved at runtime from user.archetype. When archetype is unknown we
// fall back to the generic "warm, sharp, dry" voice already in VOICE.
function archetypeToneBlock(archetype: string | null): string {
  if (!archetype) return ''
  const a = archetype.toLowerCase()
  if (a.includes('free spirit') || a.includes('drifter') || a.includes('explorer')) {
    return `\nARCHETYPE TONE\n  Lean into freedom-vs-cost framings. They know they like the night out / the trip / the spontaneous yes — surface what it cost in their own terms, never moralise. They don't want a budget; they want awareness.`
  }
  if (a.includes('builder') || a.includes('saver') || a.includes('steady')) {
    return `\nARCHETYPE TONE\n  Surface efficiency and unseen wins. They want to feel competent, not spotted doing something wrong. Frame surprises as optimisation opportunities rather than habits to fix.`
  }
  if (a.includes('provider') || a.includes('devoted') || a.includes('caretaker')) {
    return `\nARCHETYPE TONE\n  Frame in terms of who/what the spend supports. They relate to money through provision and care. Surprises about *self*-spend can feel exposing — soften with curiosity rather than accountability.`
  }
  if (a.includes('hustler') || a.includes('striver') || a.includes('earner')) {
    return `\nARCHETYPE TONE\n  They live in cost-of-time / opportunity-cost framings. Hours-of-work comparisons land harder than category percentages. "That cluster is the equivalent of a Tuesday afternoon" beats "8% of your spend".`
  }
  return `\nARCHETYPE TONE\n  Match the energy of the archetype name in tone. Read what it implies about how this user relates to money and meet them there.`
}

function renderEvidence(evidence: Evidence): string {
  const claimLines = evidence.verifiable_claims
    .map((c) => `    - ${c.kind}: ${JSON.stringify(c.value)} (alt: ${c.alt_forms.slice(0, 5).join(' | ') || '—'})`)
    .join('\n')
  const contextLines = Object.entries(evidence.context_facts)
    .map(([k, v]) => `    - ${k}: ${v}`)
    .join('\n')

  return `  source: ${evidence.source}
  brief: ${evidence.brief}
  verifiable_claims:
${claimLines}
  context_facts:
${contextLines || '    -'}`
}

function tierBlock(tier: Tier, dataDepth?: { days: number; txCount: number }): string {
  if (tier === 'tier_1') {
    return `TIER: Showstopper. The evidence above is the headline observation — make the user feel seen. The wow comes from naming a number they hadn't tallied themselves. Don't soften it; don't apologise for noticing.`
  }
  if (tier === 'tier_2') {
    return `TIER: Reframe. The numbers look in good shape — no leak, no double-bill, no cluster worth flagging. Author the four beats as a positive read followed by a pivot.

  In 'observed': mention TWO specific numbers from the evidence pool — top spend category by share, and EITHER savings discipline (low Leak %) OR income-spend gap. Acknowledge the user is already where most people want to be; don't be cute about it.

  In 'named': frame the strength as IDENTITY, not absence. Examples: "The Quiet Saver", "Already Sorted", "Builder, Not Spender". Avoid generic "Tidy Mover" / "Doing Fine" labels.

  In 'asked': pivot to time/admin, not money. "How much of your week is going to managing this?" or "What would you do if money felt fully managed?" Open the conversation toward the next problem, not a smaller one.

  In 'proposed': 7-day NOTICING task about TIME, not money. Concrete: "jot every minute spent on banking, transfers, reconciling — we'll find the friction together." Keep the warm tone.`
  }
  return `TIER: Honest tease. Only ${dataDepth?.days ?? 'a few'} days of data, ${dataDepth?.txCount ?? 'a small number of'} transactions — not enough for confident pattern reads, but plenty to start a relationship.

  In 'observed': acknowledge the thin data in ONE short line, never apologise. Then deliver the best partial observation as if it were a real read; the partial-ness is a feature, not a caveat. The user should feel "they're already paying attention to me," not "they're hedging."

  In 'named': tentative but specific. "Early Read" is fine; better is something tied to the actual partial observation ("First Glance: Aldi", "What I Can See So Far").

  In 'asked': a question that turns the data gap into curiosity, not friction.

  In 'proposed': make uploading more feel like upgrading the relationship, not a chore. Offer a concrete payoff: "send me the last 3 statements and I'll show you where each €100 actually goes." 7-day frame still applies.`
}

// ── Fallback rendering ────────────────────────────────────────────────────

function makeResult(fields: AuthoredFields): WowMomentResult {
  return {
    observed: fields.observed,
    named: fields.named,
    asked: fields.asked,
    proposed: fields.proposed,
    narrative: fields.observed,
    pattern_name: fields.named,
    experiment_text: fields.proposed,
  }
}

// Honest narrative-only fallback. Used ONLY when both Opus attempts fail
// validation (or the model errors out). Renders a 1-2 sentence read derived
// from the evidence's own headline + brief, with NO template substitution
// — that path produced literal lies like "0% of every €" when payload
// values were missing.
//
// `InsightBeat.tsx`'s narrative-only path renders this as a single
// "Let's keep going" CTA — no four beats, no fake authoring.
function synthesisedFallback(input: AuthorInput): WowMomentResult {
  const narrative = synthesisedObserved(input.evidence, input.tier)
  return {
    observed: narrative,
    named: '',
    asked: '',
    proposed: '',
    narrative,
  }
}

function synthesisedObserved(evidence: Evidence | null, tier: Tier): string {
  if (!evidence) {
    return tier === 'tier_3'
      ? "I've started reading your numbers but I don't have enough yet to tell you something sharp. Send me a couple more statements and the patterns will come into focus."
      : "Your numbers look in good shape from what I can see. Nothing screaming for attention yet."
  }
  // Lean on the brief (which is interpretation-flavoured) rather than the
  // headline (which is bare facts).
  return evidence.brief
}

// Helper for the route to materialise an AuthoredWowMoment alongside a
// ready-to-render WowMomentResult.
export function toAuthoredWowMoment(
  result: WowMomentResult,
  evidence: Evidence | null,
  tier: Tier,
): AuthoredWowMoment {
  return {
    tier,
    evidence_id: evidence?.evidence_id ?? 'fallback',
    observed: result.observed,
    named: result.named,
    asked: result.asked,
    proposed: result.proposed,
    narrative: result.narrative ?? result.observed,
  }
}
