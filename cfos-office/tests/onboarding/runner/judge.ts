import { generateText } from 'ai'
import { utilityModel, utilityModelId } from '@/lib/ai/provider'
import { checkReadHardRules } from '@/lib/ai/read-judge'
import type { Persona } from '../personas/types'
import type { CsvSummary } from './csv-summariser'
import type { JudgeOutput, HardRuleResult, LikertResult, ReadKind } from './types'

/** Harness-only word cap for the reality-check Read (see evaluateHardRules). The
 *  prod READ_WORD_CAP (250) governs the estimate Read; the reality Read's
 *  estimate-vs-reality walk across five bands runs longer. */
const REALITY_READ_WORD_CAP = 300

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

function checkMinimalNumbers(text: string, csv: CsvSummary | null, extraPlausible: number[] = []): HardRuleResult {
  if (!csv) return { ruleId: 'R4_numbers_match_csv', passed: true }
  const round2 = (n: number) => Math.round(n * 100) / 100
  const plausible = [
    ...csv.allNumbersMentioned,
    ...csv.topMerchants.map((m) => round2(m.total)),
    round2(csv.incomeTotal),
    round2(csv.spendingTotal),
    ...extraPlausible,
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

// Every estimates-first persona has a goal — the estimate goal beat creates one
// from pinned config — so a Read must never deny having one. Universal check.
function checkGoalDenial(text: string): HardRuleResult {
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

// start_statement_check is the estimate Read's close (OB-2); start_value_map_real
// is the reality-check Read's close (OB-3). Both belong to the allowed set.
const ALLOWED_CTA_TYPES = [
  'supply_input',
  'set_goal',
  'start_value_map_real',
  'start_statement_check',
  'cut_lever',
]

function extractCtaTypes(text: string): string[] {
  return [...text.matchAll(/\[CTA:([a-z_]+)\]/gi)].map((m) => m[1].toLowerCase())
}

function checkCtaVocabulary(text: string): HardRuleResult {
  const types = extractCtaTypes(text)
  if (types.length === 0) return { ruleId: 'R8_cta_vocabulary', passed: true } // H3 handles "missing CTA"
  const bad = types.filter((t) => !ALLOWED_CTA_TYPES.includes(t))
  return bad.length
    ? { ruleId: 'R8_cta_vocabulary', passed: false, detail: `unknown CTA type(s): ${bad.join(', ')}` }
    : { ruleId: 'R8_cta_vocabulary', passed: true }
}

/** The estimate Read must close on start_statement_check; the reality-check Read
 *  on start_value_map_real (CTA contract per outputType — guards against drift). */
function checkCtaMatchesRead(text: string, outputType: ReadKind): HardRuleResult {
  const types = extractCtaTypes(text)
  if (types.length === 0) return { ruleId: 'R8b_cta_matches_read', passed: true } // H3 handles "missing CTA"
  const expected = outputType === 'estimate_read' ? 'start_statement_check' : 'start_value_map_real'
  const ok = types.length === 1 && types[0] === expected
  return {
    ruleId: 'R8b_cta_matches_read',
    passed: ok,
    detail: ok ? undefined : `expected exactly [CTA:${expected}], got: ${types.join(', ') || '(none)'}`,
  }
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

/** Human-readable label for the Read being judged (fills {output_type}). */
function readTypeLabel(outputType: ReadKind): string {
  return outputType === 'estimate_read' ? 'estimate read' : 'reality-check read'
}

function buildPersonaBlock(persona: Persona): string {
  const e = persona.expectations
  return [
    `id: ${persona.id}`,
    `label: ${persona.label}`,
    `country: ${persona.profile.country}`,
    `currency: ${persona.profile.currency}`,
    `top_value: ${e.topValue}`,
    `verdicts: subscriptions=${e.verdicts.subscriptions}, eating_out=${e.verdicts.foodOut}, drift=${e.verdicts.drift}`,
  ].join('\n')
}

async function callLlmJudge(
  persona: Persona,
  outputType: ReadKind,
  content: string,
  csvSummary: CsvSummary | null,
): Promise<{ likert: LikertResult[]; raw: unknown; modelId: string }> {
  const prompt = JUDGE_PROMPT_TEMPLATE
    .replace('{persona_block}', buildPersonaBlock(persona))
    .replace('{output_type}', readTypeLabel(outputType))
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
  outputType: ReadKind,
  content: string,
  csvSummary: CsvSummary | null,
): HardRuleResult[] {
  const rules = persona.expectations.hardRules
  const out: HardRuleResult[] = []

  // Universal voice / safety checks (apply to both Reads).
  out.push(checkBannedWords(content, rules?.bannedWords))
  out.push(checkBannedPatterns(content, rules?.bannedPatterns))
  out.push(checkSystemNoteLeak(content))
  out.push(checkGoalDenial(content))

  // Read format + currency + CTA contract.
  out.push(checkCurrencySymbol(content, persona))
  out.push(checkCtaVocabulary(content))
  out.push(checkCtaMatchesRead(content, outputType))

  // Grounding check (estimate Read only): the band-built estimate Read is the
  // one prone to drifting off its inputs. The reality-check Read is grounded by
  // the deltas it cites + the CSV-anchored R4 below, so it skips this.
  if (outputType === 'estimate_read') {
    out.push(checkMustMentionOneOf(content, rules?.read?.mustReferenceOneOf, 'R3b_read_mentions_one_of'))
  }

  // R4: numeric grounding. For the estimate Read the runner passes csvSummary=null
  // (no statement exists yet → every band figure is an honest ≈ sketch, so R4 is
  // a no-op); for the reality-check Read it passes the uploaded statement's
  // summary so a hallucinated figure is caught.
  out.push(checkMinimalNumbers(content, csvSummary))

  // H1–H7 format/voice rules shared with the prod composer (read-judge.ts). H3b
  // (value_first CTA) is intentionally NOT enforced via mode here — R8b above
  // does the per-Read CTA contract. H8 (merchant citation) is not invoked: the
  // estimate Read has no merchants by design, and the reality-check Read leads
  // with deltas, so neither reliably cites a single merchant.
  //
  // Word cap: the estimate Read uses the shared READ_WORD_CAP (250); the
  // reality-check Read is a distinct format — it walks estimate-vs-reality across
  // up to five bands, so it runs longer than the cap was calibrated for (live
  // reality Reads land ~250–270). We give it headroom HERE in the harness only;
  // the prod READ_WORD_CAP is unchanged. (Follow-up: calibrate the prod cap /
  // composer length target for the reality_check mode — out of OB-4's scope.)
  const wordCap = outputType === 'reality_check_read' ? REALITY_READ_WORD_CAP : undefined
  for (const r of checkReadHardRules(content, { mode: 'default', wordCap })) {
    out.push({ ruleId: r.ruleId, passed: r.passed, detail: r.detail })
  }

  return out
}

// ── Public entry point ─────────────────────────────────────────────────────

export async function judgeOutput(
  persona: Persona,
  outputType: ReadKind,
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
