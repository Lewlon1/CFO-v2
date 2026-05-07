import type { ValueMapResult, ValueQuadrant } from '@/lib/value-map/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReactionContext {
  transactionIndex: number          // 0-based index of current transaction
  responses: ValueMapResult[]       // all responses so far (including current)
  currentResponse: ValueMapResult   // the just-categorised transaction
  totalTransactions: number         // total number of transactions in the exercise
}

type TriggerType =
  | 'speed_fast'
  | 'speed_slow'
  | 'unsure'
  | 'hard_to_decide'
  | 'midpoint'
  | 'surprising'

// ── Surprising categorisation expectations ─────────────────────────────────

const EXPECTED_QUADRANTS: Record<string, ValueQuadrant[]> = {
  // Merchants where a certain categorisation would be surprising
  gym: ['investment', 'foundation'],
  puregym: ['investment', 'foundation'],
  netflix: ['foundation', 'leak'],
  spotify: ['foundation', 'leak'],
  savings: ['investment', 'foundation'],
  rent: ['foundation'],
  mortgage: ['foundation'],
  uber: ['foundation', 'leak'],
  deliveroo: ['leak', 'foundation'],
  amazon: ['foundation', 'leak'],
  council: ['foundation', 'burden'],
  electric: ['foundation', 'burden'],
  gas: ['foundation', 'burden'],
  water: ['foundation', 'burden'],
  insurance: ['foundation', 'burden'],
}

function isSurprising(merchant: string, quadrant: ValueQuadrant | null): boolean {
  if (!quadrant) return false
  const key = merchant.toLowerCase()
  for (const [pattern, expected] of Object.entries(EXPECTED_QUADRANTS)) {
    if (key.includes(pattern) && !expected.includes(quadrant)) {
      return true
    }
  }
  return false
}

// ── Templates ─────────────────────────────────────────────────────────────────

const TEMPLATES: Record<TriggerType, string[]> = {
  speed_fast: [
    "You're decisive — that tells me you've already thought about these questions before.",
    "Quick decisions across the board. You know where you stand — now let's see if your money agrees.",
    "Fast and confident. Either you've got a clear framework or strong instincts. We'll find out which.",
  ],
  speed_slow: [
    "You're taking your time. Good. These aren't easy questions when you're being honest.",
    "Careful deliberation on each one. That kind of thoughtfulness is rare — and useful.",
  ],
  unsure: [
    "Not sure about that one? Those grey areas are often where the most interesting patterns hide.",
    "Honest answer. The ones you can't categorise easily are usually the ones worth examining.",
    "Unsure is a valid answer. It tells me something about where your relationship with money is genuinely unresolved.",
  ],
  hard_to_decide: [
    "That hesitation is worth remembering. We'll come back to it when we have your real numbers.",
    "Hard to decide — noted. That tension between categories is exactly what I'm looking for.",
  ],
  midpoint: [
    "Halfway there. I'm starting to see a pattern forming.",
    "Interesting choices so far. The second half usually reveals more — keep going.",
    "Five down, five to go. Your instincts are telling me a lot already.",
  ],
  surprising: [
    "Interesting — most people wouldn't put that there. That's a strong signal.",
    "That's an unusual categorisation. I'll remember it — it tells me something about your priorities.",
    "Not the typical call on that one. Your reasoning matters more than the norm.",
  ],
}

// Track which triggers have fired to avoid over-reacting
let firedTriggers: Set<string> = new Set()

function pickTemplate(trigger: TriggerType): string {
  const options = TEMPLATES[trigger]
  return options[Math.floor(Math.random() * options.length)]
}

// ── Main logic ────────────────────────────────────────────────────────────────

export function shouldReact(ctx: ReactionContext): boolean {
  // Reset triggers on first transaction
  if (ctx.transactionIndex === 0) {
    firedTriggers = new Set()
  }

  const trigger = detectTrigger(ctx)
  if (!trigger) return false

  // Don't fire the same trigger type twice (except unsure/hard_to_decide)
  if (trigger !== 'unsure' && trigger !== 'hard_to_decide' && firedTriggers.has(trigger)) {
    return false
  }

  // Cap at 3 reactions total per exercise
  if (firedTriggers.size >= 3) return false

  firedTriggers.add(trigger)
  return true
}

export function getReactionMessage(ctx: ReactionContext): string | null {
  const trigger = detectTrigger(ctx)
  if (!trigger) return null
  return pickTemplate(trigger)
}

function detectTrigger(ctx: ReactionContext): TriggerType | null {
  const { transactionIndex, responses, currentResponse, totalTransactions } = ctx
  const midpoint = Math.floor(totalTransactions / 2)

  // Priority 1: Hard to decide / unsure
  if (currentResponse.hard_to_decide) {
    return 'hard_to_decide'
  }

  if (currentResponse.quadrant === null) {
    return 'unsure'
  }

  // Priority 2: Surprising categorisation
  if (isSurprising(currentResponse.merchant, currentResponse.quadrant)) {
    return 'surprising'
  }

  // Priority 3: Speed pattern (check after 2-3 transactions)
  if (transactionIndex === 2 || transactionIndex === 3) {
    const allFast = responses.every((r) => r.card_time_ms < 2500)
    const allSlow = responses.every((r) => r.card_time_ms > 5000)

    if (allFast && !firedTriggers.has('speed_fast')) return 'speed_fast'
    if (allSlow && !firedTriggers.has('speed_slow')) return 'speed_slow'
  }

  // Priority 4: Midpoint observation
  if (transactionIndex === midpoint && !firedTriggers.has('midpoint')) {
    return 'midpoint'
  }

  return null
}
