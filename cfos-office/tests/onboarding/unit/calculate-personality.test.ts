import { describe, it, expect } from 'vitest'
import { calculatePersonality } from '@/lib/value-map/personalities'
import { SAMPLE_TRANSACTIONS } from '@/lib/value-map/constants'
import { PERSONAS } from '../personas'
import type { ValueMapResult } from '@/lib/value-map/types'
import type { Persona } from '../personas/types'

function scriptedToResults(persona: Persona): ValueMapResult[] {
  if (!persona.valueMapResponses) return []
  return persona.valueMapResponses.map((r) => {
    const card = SAMPLE_TRANSACTIONS.find((t) => t.id === r.cardId)
    if (!card) throw new Error(`Unknown cardId in persona ${persona.id}: ${r.cardId}`)
    return {
      transaction_id: r.cardId,
      quadrant: r.quadrant,
      merchant: card.description ?? card.merchant ?? r.cardId,
      amount: card.amount,
      confidence: r.confidence,
      first_tap_ms: r.firstTapMs,
      card_time_ms: r.cardTimeMs,
      deliberation_ms: r.deliberationMs,
      hard_to_decide: r.hardToDecide,
    }
  })
}

describe('persona scripted Value Map responses produce expected archetype', () => {
  // Iterates registry — new personas automatically get coverage as added.
  for (const persona of PERSONAS) {
    if (!persona.valueMapResponses) continue // skip personas that skip Value Map

    it(`${persona.id}: calculatePersonality returns ${persona.expectations.archetype.personalityId}`, () => {
      const results = scriptedToResults(persona)
      const out = calculatePersonality(results)
      expect(out.personality).toBe(persona.expectations.archetype.personalityId)
    })
  }

  it('registry is populated', () => {
    expect(PERSONAS.length).toBeGreaterThan(0)
  })
})
