import { generateText } from 'ai'
import { utilityModel, utilityModelId } from '@/lib/ai/provider'
import { checkReadHardRules } from '@/lib/ai/read-judge'
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

function extractNumbers(text: string): number[] {
  const matches = text.match(/-?\d+(?:\.\d+)?/g) ?? []
  return matches.map(Number).filter((n) => Number.isFinite(n))
}

function checkNumbersMatchCsv(text: string, csvSummary: CsvSummary | null): HardRuleResult {
  if (!csvSummary) return { ruleId: 'R4_numbers_match_csv', passed: true }
  const quoted = extractNumbers(text)
  const allowed = new Set([...csvSummary.allNumbersMentioned])
  const violations: number[] = []
  for (const n of quoted) {
    if (n < 10) continue
    if (n === Math.round(csvSummary.spendingTotal * 100) / 100) continue
    if (n === Math.round(csvSummary.incomeTotal * 100) / 100) continue
    // Tolerate rounding: match if n matches any csv number within 1% or ±1 currency unit
    let ok = false
    for (const num of allowed) {
      if (num === n) { ok = true; break }
      if (Math.abs(num - n) < Math.max(1, num * 0.01)) { ok = true; break }
    }
    if (!ok) violations.push(n)
  }
  if (violations.length > 0) {
    return {
      ruleId: 'R4_numbers_match_csv',
      passed: false,
      detail: `Numbers not found in CSV: ${violations.slice(0, 5).join(', ')}`,
    }
  }
  return { ruleId: 'R4_numbers_match_csv', passed: true }
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

  if (outputType === 'archetype') {
    out.push(checkMustMentionOneOf(content, rules?.archetype?.mustMentionOneOf, 'R2_archetype_mentions_one_of'))
    out.push(checkMustMentionOneOf(content, rules?.archetype?.mustAcknowledgeOneOf, 'R2b_archetype_acknowledges_one_of'))
    if (rules?.archetype?.mustReferenceQuadrant) {
      out.push(checkMustMentionOneOf(content, [rules.archetype.mustReferenceQuadrant], 'R2c_archetype_references_quadrant'))
    }
  } else {
    out.push(checkMustMentionOneOf(content, rules?.insight?.mustReferenceMerchantsFromCsv, 'R3_insight_references_csv_merchants'))
    out.push(checkMustMentionOneOf(content, rules?.insight?.mustReferenceOneOf, 'R3b_insight_mentions_one_of'))
    if (rules?.insight?.numbersMustMatchCsv) {
      out.push(checkNumbersMatchCsv(content, csvSummary))
    }
    // NOTE: the retired `isValueFirst` detection (mode 'value_first' → the H3b
    // rule asserting the CTA is `start_value_map_real`) is intentionally dropped.
    // The live product emits supply_input/set_goal CTAs, not start_value_map_real
    // (CTA contract drift — see the plan's decision D5). A later task replaces it
    // with an R8 CTA-vocabulary rule. Always use mode: 'default' here.
    const knownMerchants = csvSummary?.topMerchants.map((m) => m.description.toLowerCase()) ?? []
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
