import { generateText } from 'ai'
import { utilityModel, utilityModelId } from '@/lib/ai/provider'
import { checkReadHardRules } from '@/lib/ai/read-judge'
import { normaliseMerchantDescription } from '@/lib/analytics/merchant-normalise'
import type { Persona } from '../personas/types'
import type { CsvSummary } from './csv-summariser'
import type { JudgeOutput, HardRuleResult, LikertResult } from './types'

// ── Content unwrap ───────────────────────────────────────────────────────────

/** Unwrap the captured insight (a message wrapper `{content}`) to its content string. */
export function readContent(cfoOutput: unknown): string {
  if (typeof cfoOutput === 'string') return cfoOutput
  if (cfoOutput && typeof cfoOutput === 'object' && 'content' in cfoOutput) {
    const c = (cfoOutput as { content?: unknown }).content
    if (typeof c === 'string') return c
  }
  return JSON.stringify(cfoOutput)
}

// ── Hard-rule pre-checks (deterministic, run before the LLM) ────────────────

function checkBannedWords(text: string, banned: string[] | undefined): HardRuleResult {
  if (!banned?.length) return { ruleId: 'R1_no_banned_words', passed: true }
  const lower = text.toLowerCase()
  for (const word of banned) {
    if (lower.includes(word.toLowerCase())) {
      return {
        ruleId: 'R1_no_banned_words',
        passed: false,
        detail: `Contains banned word: "${word}"`,
      }
    }
  }
  return { ruleId: 'R1_no_banned_words', passed: true }
}

function checkBannedPatterns(text: string, patterns: string[] | undefined): HardRuleResult {
  if (!patterns?.length) return { ruleId: 'R1b_no_banned_patterns', passed: true }
  for (const src of patterns) {
    const re = new RegExp(src, 'i')
    if (re.test(text)) {
      return {
        ruleId: 'R1b_no_banned_patterns',
        passed: false,
        detail: `Matches banned pattern: /${src}/i`,
      }
    }
  }
  return { ruleId: 'R1b_no_banned_patterns', passed: true }
}

function checkMustMentionOneOf(text: string, candidates: string[] | undefined, ruleId: string): HardRuleResult {
  if (!candidates?.length) return { ruleId, passed: true }
  const lower = text.toLowerCase()
  const hit = candidates.some((c) => lower.includes(c.toLowerCase()))
  return {
    ruleId,
    passed: hit,
    detail: hit ? undefined : `Expected at least one of: ${candidates.join(', ')}`,
  }
}

/** Currency-anchored money tokens only: £/€/$ then digits with optional thousands commas/decimals. */
function extractMoneyTokens(text: string): number[] {
  const re = /[£€$]\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/g
  const out: number[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1].replace(/,/g, ''))
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

function checkMinimalNumbers(text: string, csv: CsvSummary | null): HardRuleResult {
  if (!csv) return { ruleId: 'R4_numbers_match_csv', passed: true }
  const round2 = (n: number) => Math.round(n * 100) / 100
  const plausible = [
    ...csv.allNumbersMentioned,
    ...csv.topMerchants.map((m) => round2(m.total)),
    round2(csv.incomeTotal),
    round2(csv.spendingTotal),
  ]
  const within = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, b * 0.01)
  const violations: number[] = []
  // Egregious floor: income-aware so legitimately-quoted monthly income / free
  // cash flow (which can exceed a low total tracked spend) are not false-flagged.
  // Only figures far above the larger of total spend or total income are caught.
  const egregiousFloor = Math.max(csv.spendingTotal, csv.incomeTotal) * 1.5
  for (const n of extractMoneyTokens(text)) {
    const ok = plausible.some((p) => within(n, p))
    if (!ok && n > egregiousFloor) violations.push(n)
  }
  return violations.length
    ? { ruleId: 'R4_numbers_match_csv', passed: false, detail: `Implausible money figure(s) exceeding egregious floor: ${violations.slice(0, 5).join(', ')}` }
    : { ruleId: 'R4_numbers_match_csv', passed: true }
}

const CURRENCY_SYMBOL: Record<string, string> = { GBP: '£', EUR: '€', USD: '$' }
const ALL_SYMBOLS = ['£', '€', '$']

function checkCurrencySymbol(text: string, persona: Persona): HardRuleResult {
  const expected = CURRENCY_SYMBOL[(persona.profile.currency ?? '').toUpperCase()]
  if (!expected) return { ruleId: 'R5_currency_symbol', passed: true } // unknown currency — skip
  for (const sym of ALL_SYMBOLS) {
    if (sym !== expected && text.includes(sym)) {
      return { ruleId: 'R5_currency_symbol', passed: false, detail: `foreign symbol "${sym}" present, expected "${expected}"` }
    }
  }
  const quotesMoney = /\d{2,}/.test(text)
  if (quotesMoney && !text.includes(expected)) {
    return { ruleId: 'R5_currency_symbol', passed: false, detail: `expected symbol "${expected}" not found` }
  }
  return { ruleId: 'R5_currency_symbol', passed: true }
}

const GOAL_DENIAL_RE: RegExp[] = [
  /\bno (active )?goal\b/i,
  /\bdon'?t have (a|any) goal\b/i,
  /\bwithout a goal\b/i,
  /\bhaven'?t set (a|any) goal\b/i,
  /\bno goal (attached|set|on file)\b/i,
]

function checkGoalDenial(text: string, persona: Persona): HardRuleResult {
  if (!persona.expectations.goal) return { ruleId: 'R6_no_goal_denial', passed: true }
  const hit = GOAL_DENIAL_RE.find((re) => re.test(text))
  return hit
    ? { ruleId: 'R6_no_goal_denial', passed: false, detail: `goal-denial phrase matched ${hit}` }
    : { ruleId: 'R6_no_goal_denial', passed: true }
}

function checkSystemNoteLeak(text: string): HardRuleResult {
  return /\(System note:/i.test(text)
    ? { ruleId: 'R7_no_system_note', passed: false, detail: 'leaked "(System note: …)" QA diagnostic' }
    : { ruleId: 'R7_no_system_note', passed: true }
}

const ALLOWED_CTA_TYPES = ['supply_input', 'set_goal', 'start_value_map_real']

function checkCtaVocabulary(text: string): HardRuleResult {
  const types = [...text.matchAll(/\[CTA:([a-z_]+)\]/gi)].map((m) => m[1].toLowerCase())
  if (types.length === 0) return { ruleId: 'R8_cta_vocabulary', passed: true } // H3 handles "missing CTA"
  const bad = types.filter((t) => !ALLOWED_CTA_TYPES.includes(t))
  return bad.length
    ? { ruleId: 'R8_cta_vocabulary', passed: false, detail: `unknown CTA type(s): ${bad.join(', ')}` }
    : { ruleId: 'R8_cta_vocabulary', passed: true }
}

// ── LLM judge for subjective dimensions ─────────────────────────────────────

const JUDGE_PROMPT_TEMPLATE = `You are grading output from "your CFO" — a personal-finance AI in The CFO's Office.

<persona>
{persona_block}
</persona>

<cfo_output_type>{output_type}</cfo_output_type>

<cfo_output>
{cfo_output}
</cfo_output>

<source_csv_summary>
{csv_summary}
</source_csv_summary>

Score the output 1-5 across these dimensions, with a single-sentence justification each:

- L1_warmth: Smart-friend tone vs cold/lecturing
- L2_accuracy: Claims grounded in source data (no hallucinated figures or merchants)
- L3_on_brand: Matches CFO voice (no "advice"/"advise" language, uses tangible comparisons, never preachy)
- L4_persona_fit: Feels written for this specific user, not generic
- L5_actionability: Points toward next action or concrete insight

Return JSON ONLY in this exact shape, nothing else:
{
  "L1_warmth": { "score": 4, "reason": "..." },
  "L2_accuracy": { "score": 5, "reason": "..." },
  "L3_on_brand": { "score": 3, "reason": "..." },
  "L4_persona_fit": { "score": 4, "reason": "..." },
  "L5_actionability": { "score": 4, "reason": "..." }
}`

function buildPersonaBlock(persona: Persona): string {
  // archetype is null for chat-first personas, but those personas don't run
  // the LLM judge (their likertDimensions is empty), so we never reach here
  // without an archetype. Fall back to '(none)' defensively.
  const archetype = persona.expectations.archetype
  return [
    `id: ${persona.id}`,
    `label: ${persona.label}`,
    `country: ${persona.profile.country}`,
    `currency: ${persona.profile.currency}`,
    `target_archetype: ${archetype?.personalityId ?? '(none)'}`,
    `target_dominant_quadrant: ${archetype?.expectedQuadrant ?? '(none)'}`,
  ].join('\n')
}

async function callLlmJudge(
  persona: Persona,
  outputType: 'archetype' | 'insight',
  content: string,
  csvSummary: CsvSummary | null,
): Promise<{ likert: LikertResult[]; raw: unknown; modelId: string }> {
  const prompt = JUDGE_PROMPT_TEMPLATE
    .replace('{persona_block}', buildPersonaBlock(persona))
    .replace('{output_type}', outputType)
    .replace('{cfo_output}', content)
    .replace('{csv_summary}', csvSummary?.asText() ?? 'No CSV uploaded for this persona.')

  const { text } = await generateText({
    model: utilityModel,
    prompt,
    temperature: 0,
  })

  // Extract JSON (Haiku may occasionally wrap in prose)
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error(`Judge returned no JSON: ${text.slice(0, 200)}`)
  }
  let parsed: Record<string, { score: number; reason: string }>
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    throw new Error(`Judge returned malformed JSON: ${jsonMatch[0].slice(0, 200)}`)
  }

  const likert: LikertResult[] = Object.entries(parsed).map(([dim, v]) => ({
    dimension: dim.replace(/^L\d_/, ''),
    score: Math.max(1, Math.min(5, Math.round(v.score))),
    reason: v.reason ?? '',
  }))

  return { likert, raw: parsed, modelId: utilityModelId }
}

// ── Pure deterministic hard-rule evaluator ────────────────────────────────

export function evaluateHardRules(
  persona: Persona,
  outputType: 'archetype' | 'insight',
  content: string,
  csvSummary: CsvSummary | null,
): HardRuleResult[] {
  const rules = persona.expectations.hardRules
  const out: HardRuleResult[] = []
  out.push(checkBannedWords(content, rules?.bannedWords))
  out.push(checkBannedPatterns(content, rules?.bannedPatterns))
  out.push(checkSystemNoteLeak(content))
  out.push(checkGoalDenial(content, persona))

  if (outputType === 'archetype') {
    out.push(checkMustMentionOneOf(content, rules?.archetype?.mustMentionOneOf, 'R2_archetype_mentions_one_of'))
    out.push(checkMustMentionOneOf(content, rules?.archetype?.mustAcknowledgeOneOf, 'R2b_archetype_acknowledges_one_of'))
    if (rules?.archetype?.mustReferenceQuadrant) {
      out.push(checkMustMentionOneOf(content, [rules.archetype.mustReferenceQuadrant], 'R2c_archetype_references_quadrant'))
    }
  } else {
    const MERCHANT_CITATION_MIN_TXNS = 20
    const txnCount = csvSummary?.transactionCount ?? 0
    out.push(checkCurrencySymbol(content, persona))
    out.push(checkCtaVocabulary(content))
    if (txnCount >= MERCHANT_CITATION_MIN_TXNS) {
      out.push(checkMustMentionOneOf(content, rules?.insight?.mustReferenceMerchantsFromCsv, 'R3_insight_references_csv_merchants'))
    }
    out.push(checkMustMentionOneOf(content, rules?.insight?.mustReferenceOneOf, 'R3b_insight_mentions_one_of'))
    out.push(checkMinimalNumbers(content, csvSummary))
    // NOTE: the retired `isValueFirst` detection (mode 'value_first' → the H3b
    // rule asserting the CTA is `start_value_map_real`) is intentionally dropped.
    // The live product emits supply_input/set_goal CTAs, not start_value_map_real
    // (CTA contract drift — see the plan's decision D5). R8 now validates CTA
    // vocabulary against the full allowed set. Always use mode: 'default' here.
    // Pass BOTH the raw lowercased description and the normalised form: the Read's
    // prose usually quotes the merchant as-it-appears, while clusters_referenced
    // use the normalised key. Matching either avoids H8 false-fails from
    // normalisation drift.
    const knownMerchants =
      txnCount >= MERCHANT_CITATION_MIN_TXNS
        ? (csvSummary?.topMerchants.flatMap((m) => [
            m.description.toLowerCase(),
            normaliseMerchantDescription(m.description).toLowerCase(),
          ]) ?? [])
        : []
    for (const r of checkReadHardRules(content, { mode: 'default', knownMerchants })) {
      out.push({ ruleId: r.ruleId, passed: r.passed, detail: r.detail })
    }
  }
  return out
}

// ── Public entry point ─────────────────────────────────────────────────────

export async function judgeOutput(
  persona: Persona,
  outputType: 'archetype' | 'insight',
  cfoOutput: unknown,
  csvSummary: CsvSummary | null,
): Promise<JudgeOutput> {
  const content = readContent(cfoOutput)

  const hardRules: HardRuleResult[] = evaluateHardRules(persona, outputType, content, csvSummary)

  let likert: LikertResult[] = []
  let raw: unknown = null
  let modelId = utilityModelId
  try {
    const judged = await callLlmJudge(persona, outputType, content, csvSummary)
    likert = judged.likert
    raw = judged.raw
    modelId = judged.modelId
  } catch (e) {
    hardRules.push({ ruleId: 'R0_judge_call_succeeded', passed: false, detail: String(e) })
  }

  return { outputType, modelId, timestamp: new Date().toISOString(), hardRules, likert, raw }
}
