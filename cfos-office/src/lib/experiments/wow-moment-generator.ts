import { generateText } from 'ai'
import { chatModel } from '@/lib/ai/provider'
import { TEMPLATES, substitute } from './observation-templates'
import { nextSundayAt } from './scheduling'
import type {
  ActiveExperimentInsert,
  ObservationCandidate,
  WowMomentResult,
} from './types'

export interface UserContext {
  display_name: string | null
  archetype: string | null
}

export type GeneratedExperimentInsert = Omit<ActiveExperimentInsert, 'user_id' | 'accepted_at'>

const PROMPT_PREAMBLE = `You are the user's CFO — a calm, clear-eyed friend who happens to be brilliant with money. You are about to deliver the very first observation you've ever made about this person's spending. They've just uploaded their bank statements; pattern detectors have surfaced one thing worth pointing at.

This is *one* observation. You are not coaching, fixing, or recommending. You are noticing, naming, and inviting them to notice with you. The tone is: "I saw something — what do you think?"

OUTPUT FORMAT
  Wrap your single paragraph of original prose in [OBSERVED]…[/OBSERVED]. The paragraph should:
    - Greet by first name in 2–4 words.
    - Reference at most one or two of the provided facts (verbatim).
    - Lead naturally into the locked PATTERN_NAME.
    - Be at most 3 short sentences.

  Do NOT echo the OPEN_QUESTION or EXPERIMENT in your prose — the system appends them verbatim.
  Do NOT add introductions ("here's what I found"), conclusions, sign-offs, or anything outside the [OBSERVED] tags.
  Do NOT use lists, bullets, or headings.

HARD RULES — any violation fails the response:
  - You MUST wrap the prose in [OBSERVED]…[/OBSERVED].
  - You MUST NOT include any digit that is not in the provided facts.
  - You MUST NOT invent merchant names beyond those in the facts.
  - You MUST keep the tone warm and observational, never directive.`

export async function generateWowMoment(
  candidate: ObservationCandidate,
  user: UserContext,
): Promise<{ wowMoment: WowMomentResult; experimentInsert: GeneratedExperimentInsert }> {
  const templateKey = `${candidate.observation_type}.${candidate.pattern_template_key}`
  const template = TEMPLATES[templateKey]
  if (!template) {
    throw new Error(`No observation template registered for ${templateKey}`)
  }

  // Deterministic name option. A/B sampling can come later.
  const patternName = substitute(template.pattern_name_options[0], candidate.payload)
  const question = substitute(template.question_template, candidate.payload)
  const experimentText = substitute(template.experiment_template, candidate.payload)
  const noticingTargetRaw = candidate.payload[template.noticing_target_key]
  const noticingTarget =
    typeof noticingTargetRaw === 'string' && noticingTargetRaw.length > 0
      ? noticingTargetRaw
      : patternName

  const userPrompt = buildUserPrompt(patternName, question, experimentText, candidate, user)

  const result = await generateText({
    model: chatModel,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.4,
    maxOutputTokens: 280,
  })

  const observed = parseObservedBlock(result.text)
  if (!observed) {
    throw new Error('Generator did not return an [OBSERVED] block')
  }
  assertNoFabricatedNumbers(observed, candidate)

  const wowMoment: WowMomentResult = {
    observed,
    named: patternName,
    asked: question,
    proposed: experimentText,
    narrative: observed,
    pattern_name: patternName,
    experiment_text: experimentText,
  }

  const now = new Date()
  const callbackDueAt = nextSundayAt(now, { hourUTC: 18, minDaysAhead: 1, maxDaysAhead: 7 })

  const experimentInsert: GeneratedExperimentInsert = {
    observation_type: candidate.observation_type,
    pattern_template_key: candidate.pattern_template_key,
    pattern_name: patternName,
    observation_payload: candidate.payload,
    question,
    experiment_text: experimentText,
    noticing_target: noticingTarget,
    status: 'active',
    proposed_at: now.toISOString(),
    callback_due_at: callbackDueAt.toISOString(),
  }

  return { wowMoment, experimentInsert }
}

function buildUserPrompt(
  patternName: string,
  question: string,
  experimentText: string,
  candidate: ObservationCandidate,
  user: UserContext,
): string {
  const factLines: string[] = []
  for (const [key, value] of Object.entries(candidate.payload)) {
    if (value === null || value === undefined) continue
    factLines.push(`  - ${key}: ${value}`)
  }
  factLines.push(`  - currency: ${candidate.currency}`)

  const archetypeNote = user.archetype ? ` (archetype: ${user.archetype})` : ''

  return `${PROMPT_PREAMBLE}

CLIENT: ${user.display_name ?? 'the client'}${archetypeNote}

PATTERN_NAME (locked — do NOT echo in [OBSERVED]):
  ${patternName}

OPEN_QUESTION (locked — do NOT echo in [OBSERVED]):
  ${question}

EXPERIMENT (locked — do NOT echo in [OBSERVED]):
  ${experimentText}

FACTS (the only numbers/merchants you may quote):
${factLines.join('\n')}

Now write your [OBSERVED] paragraph. Output nothing before or after the [OBSERVED]…[/OBSERVED] block.`
}

function parseObservedBlock(text: string): string | null {
  const match = text.match(/\[OBSERVED\]([\s\S]*?)\[\/OBSERVED\]/i)
  if (!match) return null
  return match[1].trim()
}

const NUMBER_PATTERN = /\d[\d.,]*/g

function assertNoFabricatedNumbers(observed: string, candidate: ObservationCandidate) {
  const allowed = new Set<string>()
  for (const value of Object.values(candidate.payload)) {
    if (value === null || value === undefined) continue
    for (const match of String(value).matchAll(NUMBER_PATTERN)) {
      allowed.add(match[0])
    }
  }
  for (const match of observed.matchAll(NUMBER_PATTERN)) {
    if (!allowed.has(match[0])) {
      throw new Error(`Fabricated number in [OBSERVED]: ${match[0]}`)
    }
  }
}
