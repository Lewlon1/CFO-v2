import { describe, it, expect } from 'vitest'
import { generateArchetypeReading, type ReadingGenerateFn } from '../generate-reading'
import { getStaticReading, type ReadingFacts } from '../archetype-reading-prompt'

const FACTS: ReadingFacts = {
  family: 'security',
  certainty: 'certain',
  displayName: 'The Fortress',
  receiptHeadline: 'You sorted 10 transactions. 8 went to Foundation — about twice the typical rate.',
  receiptBands: '7 quick calls, 3 considered.',
  tensionLine: 'No contradiction in the data.',
}

describe('generateArchetypeReading — Bedrock failure handling', () => {
  it('timeout → the static cell blurb ships (the reveal never blocks)', async () => {
    // Mocked Bedrock that never resolves before the abort signal fires.
    const hanging: ReadingGenerateFn = ({ abortSignal }) =>
      new Promise((_, reject) => {
        abortSignal.addEventListener('abort', () => reject(new Error('TimeoutError')))
      })
    const result = await generateArchetypeReading(FACTS, hanging, 50)
    expect(result.source).toBe('static')
    expect(result.reading).toBe(getStaticReading('security', 'certain'))
  })

  it('thrown error → static blurb', async () => {
    const failing: ReadingGenerateFn = () => Promise.reject(new Error('Bedrock down'))
    const result = await generateArchetypeReading(FACTS, failing)
    expect(result.source).toBe('static')
    expect(result.reading).toBe(getStaticReading('security', 'certain'))
  })

  it('empty or runaway output → static blurb, never junk on screen', async () => {
    const empty: ReadingGenerateFn = () => Promise.resolve({ text: '   ' })
    expect((await generateArchetypeReading(FACTS, empty)).source).toBe('static')

    const runaway: ReadingGenerateFn = () => Promise.resolve({ text: 'x'.repeat(2000) })
    expect((await generateArchetypeReading(FACTS, runaway)).source).toBe('static')
  })

  it('well-formed output passes through untouched', async () => {
    const text =
      'You protect the base first and you know exactly why. The next move is making the surplus work as hard as the foundations.'
    const ok: ReadingGenerateFn = () =>
      Promise.resolve({ text, usage: { inputTokens: 100, outputTokens: 50 } })
    const result = await generateArchetypeReading(FACTS, ok)
    expect(result.source).toBe('llm')
    expect(result.reading).toBe(text)
    expect(result.usage?.outputTokens).toBe(50)
  })
})
