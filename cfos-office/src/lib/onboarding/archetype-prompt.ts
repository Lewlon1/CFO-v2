import type { ValueMapResult, ValueQuadrant } from '@/lib/value-map/types'
import type { ArchetypeData } from './types'

// ── Types ─────────────────────────────────────────────────────────────────────

// Canonical shape lives in `./types` as `ArchetypeData`. Re-exported here under
// the name `ArchetypeResult` because this module historically owned the LLM
// validation contract; consumers import whichever name suits the call site.
export type ArchetypeResult = ArchetypeData

// ── Helpers ───────────────────────────────────────────────────────────────────

function qualifySpeed(ms: number): string {
  if (ms < 2500) return 'instant'
  if (ms < 6000) return 'quick'
  if (ms < 15000) return 'considered'
  if (ms < 30000) return 'slow'
  return 'very slow'
}

function qualifyDeliberation(ms: number): string {
  if (ms < 1000) return 'no hesitation'
  if (ms < 4000) return 'brief pause'
  if (ms < 12000) return 'noticeable deliberation'
  return 'significant deliberation'
}

function summariseResponses(responses: ValueMapResult[]) {
  const decided = responses.filter((r) => r.quadrant !== null)
  const hardToDecide = responses.filter((r) => r.hard_to_decide)

  const byQuadrant: Record<ValueQuadrant, ValueMapResult[]> = {
    foundation: [],
    investment: [],
    burden: [],
    leak: [],
  }
  for (const r of decided) {
    if (r.quadrant) byQuadrant[r.quadrant].push(r)
  }

  const avgCardTime = responses.reduce((s, r) => s + r.card_time_ms, 0) / responses.length
  const avgConfidence =
    decided.length > 0
      ? decided.reduce((s, r) => s + r.confidence, 0) / decided.length
      : 0

  // Find fastest and slowest decisions
  const sorted = [...responses].sort((a, b) => a.card_time_ms - b.card_time_ms)
  const fastest = sorted.slice(0, 3)
  const slowest = sorted.slice(-3).reverse()

  // High confidence (4-5) and low confidence (1-2)
  const highConfidence = decided.filter((r) => r.confidence >= 4)
  const lowConfidence = decided.filter((r) => r.confidence <= 2)

  return {
    decided,
    hardToDecide,
    byQuadrant,
    avgCardTime,
    avgConfidence,
    fastest,
    slowest,
    highConfidence,
    lowConfidence,
  }
}

// ── Prompt builder ────────────────────────────────────────────────────────────

export function buildArchetypePrompt(
  responses: ValueMapResult[],
  personalityType: string,
  userName: string,
): string {
  const stats = summariseResponses(responses)

  // Build per-transaction detail block
  const transactionDetails = responses
    .map((r, i) => {
      const quadrant = r.quadrant ?? 'hard_to_decide'
      const conf = r.hard_to_decide ? 'skipped (hard to decide)' : `${r.confidence}/5`
      const speed = qualifySpeed(r.card_time_ms)
      const deliberation = r.deliberation_ms > 1000 ? `, with ${qualifyDeliberation(r.deliberation_ms)} after first tap` : ''
      return `${i + 1}. ${r.merchant} → ${quadrant} | confidence: ${conf} | speed: ${speed}${deliberation}`
    })
    .join('\n')

  // Build quadrant summary
  const quadrantSummary = (['foundation', 'investment', 'burden', 'leak'] as const)
    .map((q) => {
      const items = stats.byQuadrant[q]
      if (items.length === 0) return `${q}: none`
      const merchants = items.map((r) => r.merchant).join(', ')
      const avgConf = (items.reduce((s, r) => s + r.confidence, 0) / items.length).toFixed(1)
      return `${q} (${items.length} items, avg confidence ${avgConf}/5): ${merchants}`
    })
    .join('\n')

  // Build behavioural signals
  const signals: string[] = []

  if (stats.avgCardTime < 2500) {
    signals.push(`Overall pace: fast — most decisions came quickly.`)
  } else if (stats.avgCardTime > 6000) {
    signals.push(`Overall pace: deliberate — they took time with most decisions.`)
  }

  if (stats.hardToDecide.length > 0) {
    const merchants = stats.hardToDecide.map((r) => r.merchant).join(', ')
    signals.push(`Couldn't decide on: ${merchants} — skipped as hard to decide.`)
  }

  if (stats.highConfidence.length > 0) {
    const merchants = stats.highConfidence.map((r) => `${r.merchant} (${r.quadrant})`).join(', ')
    signals.push(`Very clear and certain about: ${merchants}.`)
  }

  if (stats.lowConfidence.length > 0) {
    const merchants = stats.lowConfidence.map((r) => `${r.merchant} (${r.quadrant})`).join(', ')
    signals.push(`Uncertain, not fully convinced about: ${merchants}.`)
  }

  if (stats.fastest.length > 0) {
    const fast = stats.fastest.map((r) => r.merchant).join(', ')
    signals.push(`Clearest, most instinctive decisions: ${fast}.`)
  }

  if (stats.slowest.length > 0) {
    const slow = stats.slowest.map((r) => r.merchant).join(', ')
    signals.push(`Required the most thought: ${slow}.`)
  }

  return `You are a personal CFO delivering a money personality reading to ${userName}.

You have just observed them categorise 10 transactions into value quadrants (Foundation, Investment, Burden, Leak) with confidence ratings and timing data. Your task is to generate a creative, specific personality archetype that captures how they relate to money.

## Their categorisation data

${transactionDetails}

## Quadrant summary

${quadrantSummary}
${stats.hardToDecide.length > 0 ? `Hard to decide: ${stats.hardToDecide.length} items` : ''}

## Behavioural signals

${signals.join('\n')}

## Deterministic personality baseline: ${personalityType}
(Use this as a starting point, but your archetype name should be more creative and specific.)

## Your task

Generate a JSON object with this exact structure:

{
  "archetype_name": "The [Name]",
  "archetype_subtitle": "One sentence that captures the core tension or insight about their money relationship",
  "traits": [
    "First observation referencing a SPECIFIC transaction choice, timing, or confidence pattern",
    "Second observation referencing a DIFFERENT specific pattern or tension in their choices",
    "Third observation that connects two patterns into a forward-looking insight"
  ],
  "certainty_areas": ["1-3 word labels for areas where they showed high confidence and fast decisions"],
  "conflict_areas": ["1-3 word labels for areas where they hesitated, had low confidence, or marked hard to decide"]
}

## Rules

- Write as the CFO speaking directly to ${userName} — "you" not "they". State findings directly; don't narrate the act of observing ("I noticed…", "I can see…"). Second person.
- Every trait MUST reference a specific merchant name or confidence pattern from the data above
- When referencing timing, ALWAYS use qualitative language only — never mention seconds, milliseconds, or any specific numbers. Use phrases like "that one took some thought", "you were very clear on that", "you hesitated", "that came to you instantly", "that one required a lot of consideration"
- Name TENSIONS, not summaries. "You called Netflix Foundation with 5/5 confidence but clearly had to think about your gym membership" is better than "You value entertainment"
- The archetype name and subtitle should be observational — describe the pattern shown in the data, never a characterological label or judgement. "No long-term plan recorded yet" is observational; "your money moves without a plan" is characterological.
- The subtitle should reveal something non-obvious — a contradiction in the data, a blind spot, or an unnamed pattern. State it as observation, not as judgement of the person.
- Keep each trait to 1-2 sentences maximum
- Do NOT prescribe actions. Observe and name patterns only. Never use the words "advice" or "advise".
- Respond with ONLY the JSON object, no other text.`
}

// ── Deterministic fallback ────────────────────────────────────────────────────

const FALLBACK_ARCHETYPES: Record<string, ArchetypeResult> = {
  builder: {
    archetype_name: 'The Builder',
    archetype_subtitle: 'Investment-heavy classifications; Foundation share to verify',
    traits: [
      'Investment was your dominant quadrant — growth-oriented spending classified with intent.',
      'Confidence on Investment calls ran high; the pattern shows clear direction.',
      'Foundation share sits below the average across the dataset — worth confirming against real transactions.',
    ],
    certainty_areas: ['growth spending', 'self-investment'],
    conflict_areas: ['essentials', 'recurring costs'],
  },
  fortress: {
    archetype_name: 'The Fortress',
    archetype_subtitle: 'Foundation-dominant classifications; cash holdings to confirm',
    traits: [
      'Foundation dominated your choices — bills, groceries, non-negotiables.',
      'Confidence across essentials ran high; stability is rated highly.',
      'Discretionary and subscription items sit unsorted or low-confidence — those are the ones to review.',
    ],
    certainty_areas: ['essential spending', 'bills'],
    conflict_areas: ['discretionary', 'subscriptions'],
  },
  truth_teller: {
    archetype_name: 'The Balancer',
    archetype_subtitle: 'Even split across four quadrants; no dominant pattern yet',
    traits: [
      'No single quadrant dominated — your spending is distributed across all four categories.',
      'The split is even enough that real transaction data will be needed to read the pattern.',
      'Confidence ran moderate across the board — no single category stood out as a strong call.',
    ],
    certainty_areas: ['overall awareness'],
    conflict_areas: ['prioritisation', 'trade-offs'],
  },
  drifter: {
    archetype_name: 'The Drifter',
    archetype_subtitle: 'No long-term plan recorded yet; Leak share above average',
    traits: [
      'Leak was your largest quadrant — small, frequent items that add up.',
      'Discretionary classifications shifted between categories, with low average confidence.',
      'Subscriptions and impulse-coded merchants are the cluster to review first against real transactions.',
    ],
    certainty_areas: ['essentials'],
    conflict_areas: ['impulse spending', 'subscriptions'],
  },
  anchor: {
    archetype_name: 'The Anchor',
    archetype_subtitle: 'Burden-heavy classifications; review which costs are renegotiable',
    traits: [
      'Burden dominated — costs classified as necessary but draining.',
      'Several Burden items may be renegotiable; the upload will surface which.',
      'Foundation share sits close to Burden share — the line between essential and resented is thin here.',
    ],
    certainty_areas: ['unavoidable costs'],
    conflict_areas: ['burden vs foundation', 'renegotiable costs'],
  },
}

export function getFallbackArchetype(personalityType: string): ArchetypeResult {
  return (
    FALLBACK_ARCHETYPES[personalityType] ??
    FALLBACK_ARCHETYPES.truth_teller
  )
}
