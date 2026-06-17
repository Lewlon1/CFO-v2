// VM-4 — the reading generation core, extracted from the route so the
// Bedrock-failure path is unit-testable. Exactly one generation call per
// reveal; any failure (timeout, throw, empty/runaway output) falls back to
// the constitution-checked static blurb for the cell. The reveal never
// blocks on Bedrock indefinitely.

import { generateText } from 'ai'
import { chatModel } from '@/lib/ai/provider'
import {
  buildReadingSystemPrompt,
  buildReadingUserMessage,
  getStaticReading,
  type ReadingFacts,
} from './archetype-reading-prompt'

export const READING_TIMEOUT_MS = 8_000

export interface GeneratedReading {
  reading: string
  source: 'llm' | 'static'
  usage?: { inputTokens?: number; outputTokens?: number }
}

/** Matches the slice of generateText this module needs — injectable for tests. */
export type ReadingGenerateFn = (args: {
  system: string
  prompt: string
  abortSignal: AbortSignal
}) => Promise<{ text: string; usage?: { inputTokens?: number; outputTokens?: number } }>

const defaultGenerate: ReadingGenerateFn = ({ system, prompt, abortSignal }) =>
  generateText({ model: chatModel, system, prompt, maxOutputTokens: 300, abortSignal })

export async function generateArchetypeReading(
  facts: ReadingFacts,
  generate: ReadingGenerateFn = defaultGenerate,
  timeoutMs: number = READING_TIMEOUT_MS,
): Promise<GeneratedReading> {
  try {
    const result = await generate({
      system: buildReadingSystemPrompt(),
      prompt: buildReadingUserMessage(facts),
      abortSignal: AbortSignal.timeout(timeoutMs),
    })
    const text = result.text.trim()
    // Guard against empty or runaway output — fall back rather than render junk.
    if (text.length >= 40 && text.length <= 1200) {
      return { reading: text, source: 'llm', usage: result.usage }
    }
    console.warn('[vm4/reading] generated text outside bounds, using static blurb')
  } catch (err) {
    console.error('[vm4/reading] generation failed, using static blurb:', err)
  }
  return { reading: getStaticReading(facts.family, facts.certainty), source: 'static' }
}
