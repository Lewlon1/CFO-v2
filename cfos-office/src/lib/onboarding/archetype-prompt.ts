import type { ValueMapResult, ValueQuadrant } from '@/lib/value-map/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ArchetypeResult {
  archetype_name: string
  archetype_subtitle: string
  traits: [string, string, string]
  certainty_areas: string[]
  conflict_areas: string[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  if (ms < 1000) return 'under a second'
  const secs = Math.round(ms / 1000)
  return secs === 1 ? '1 second' : `${secs} seconds`
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
      const time = formatMs(r.card_time_ms)
      const deliberation = r.deliberation_ms > 0 ? `, deliberated ${formatMs(r.deliberation_ms)}` : ''
      return `${i + 1}. ${r.merchant} (${r.amount > 0 ? '+' : ''}${r.amount.toFixed(2)}) → ${quadrant} | confidence: ${conf} | decided in ${time}${deliberation}`
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
    signals.push(`Fast decision-maker: average ${formatMs(stats.avgCardTime)} per card.`)
  } else if (stats.avgCardTime > 6000) {
    signals.push(`Deliberate decision-maker: average ${formatMs(stats.avgCardTime)} per card.`)
  }

  if (stats.hardToDecide.length > 0) {
    const merchants = stats.hardToDecide.map((r) => r.merchant).join(', ')
    signals.push(`Marked ${stats.hardToDecide.length} as "hard to decide": ${merchants}.`)
  }

  if (stats.highConfidence.length > 0) {
    const merchants = stats.highConfidence.map((r) => `${r.merchant} (${r.quadrant})`).join(', ')
    signals.push(`High certainty (4-5/5) on: ${merchants}.`)
  }

  if (stats.lowConfidence.length > 0) {
    const merchants = stats.lowConfidence.map((r) => `${r.merchant} (${r.quadrant})`).join(', ')
    signals.push(`Low certainty (1-2/5) on: ${merchants}.`)
  }

  if (stats.fastest.length > 0) {
    const fast = stats.fastest.map((r) => `${r.merchant} (${formatMs(r.card_time_ms)})`).join(', ')
    signals.push(`Fastest decisions: ${fast}.`)
  }

  if (stats.slowest.length > 0) {
    const slow = stats.slowest.map((r) => `${r.merchant} (${formatMs(r.card_time_ms)})`).join(', ')
    signals.push(`Slowest decisions: ${slow}.`)
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

- Write as the CFO speaking directly to ${userName} — "you" not "they"
- Every trait MUST reference a specific merchant name, specific timing, or specific confidence rating from the data above
- Name TENSIONS, not summaries. "You called Netflix Foundation with 5/5 confidence but took 8 seconds on your gym membership" is better than "You value entertainment"
- The archetype name should be evocative and unique (not "The Spender" or "The Saver" — think "The Reluctant Architect" or "The Comfortable Drifter")
- The subtitle should reveal something non-obvious — a contradiction, a blind spot, or an unconscious pattern
- Keep each trait to 1-2 sentences maximum
- Do NOT give financial advice. Observe and name patterns only.
- Respond with ONLY the JSON object, no other text.`
}

// ── Deterministic fallback ────────────────────────────────────────────────────

const FALLBACK_ARCHETYPES: Record<string, ArchetypeResult> = {
  builder: {
    archetype_name: 'The Builder',
    archetype_subtitle: 'You invest in growth — the question is whether the foundation is keeping up',
    traits: [
      'Your Investment category dominated — you see money as a tool for building something better.',
      'High confidence on growth-oriented spending tells me you know where you want to go.',
      "The test now is whether your Foundation spending is solid enough to support what you're building.",
    ],
    certainty_areas: ['growth spending', 'self-investment'],
    conflict_areas: ['essentials', 'recurring costs'],
  },
  fortress: {
    archetype_name: 'The Fortress',
    archetype_subtitle: "Your essentials are locked down — but safety can become its own kind of cage",
    traits: [
      'Foundation dominated your choices — the bills, the groceries, the non-negotiables.',
      'High confidence across essentials tells me you take stability seriously.',
      "Worth asking: are some of these Foundation costs actually habits you've stopped questioning?",
    ],
    certainty_areas: ['essential spending', 'bills'],
    conflict_areas: ['discretionary', 'subscriptions'],
  },
  truth_teller: {
    archetype_name: 'The Balancer',
    archetype_subtitle: 'Spread evenly across every quadrant — balanced, or just undecided?',
    traits: [
      'No single quadrant dominated — your spending is distributed across all four categories.',
      'That balance could mean you have a clear, intentional relationship with money.',
      'Or it could mean nothing stands out yet. Your real data will tell us which.',
    ],
    certainty_areas: ['overall awareness'],
    conflict_areas: ['prioritisation', 'trade-offs'],
  },
  drifter: {
    archetype_name: 'The Drifter',
    archetype_subtitle: 'Your money moves without a plan — and part of you already knows it',
    traits: [
      'Leak spending featured heavily — small, frequent costs that add up.',
      'The pattern suggests impulse rather than intention in your discretionary spending.',
      'The good news: awareness is the first step. Naming these as Leaks means you see the pattern.',
    ],
    certainty_areas: ['essentials'],
    conflict_areas: ['impulse spending', 'subscriptions'],
  },
  anchor: {
    archetype_name: 'The Anchor',
    archetype_subtitle: "Carrying weight you didn't choose — some of it might be lighter than you think",
    traits: [
      'Burden spending was heavy in your choices — costs that feel necessary but draining.',
      'That weight is real, but not all of it is permanent.',
      'The question is which Burdens can be renegotiated, and which you need to accept and plan around.',
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
