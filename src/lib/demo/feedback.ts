import type { ValueQuadrant } from '@/lib/value-map/types'
import { QUADRANTS } from '@/lib/value-map/constants'

/**
 * Demo-specific feedback — reflects on the user's quadrant choice
 * rather than giving spending advice (since these are sample transactions).
 *
 * Focuses on: "interesting that you saw it that way" rather than "eat out less."
 */

interface DemoFeedbackContext {
  merchant: string
  amount: number
  currency: string
  quadrant: ValueQuadrant
  cardNumber: number
  totalCards: number
}

// ── Merchant-specific reflections ───────────────────────────────────────────

interface MerchantReflection {
  pattern: RegExp
  reflections: Partial<Record<ValueQuadrant, string>>
}

const MERCHANT_REFLECTIONS: MerchantReflection[] = [
  // Food delivery
  {
    pattern: /deliveroo|glovo|doordash|lieferando|uber\s?eats|just\s?eat/i,
    reflections: {
      foundation: 'Late-night delivery as a foundation — you see convenience as a genuine need, not a luxury.',
      investment: 'Food delivery as an investment? You value your time and energy highly.',
      burden: 'It hurts but you still ordered. That tension is worth paying attention to.',
      leak: 'Most people hesitate on this one. You didn\'t — you know when money slipped away.',
    },
  },
  // Gyms
  {
    pattern: /gym|puregym|mcfit|fitx|planet\s?fitness/i,
    reflections: {
      investment: 'Health as investment — even at 3 times a month. You believe in the principle.',
      leak: 'Honest. The gap between signing up and showing up is where leaks live.',
      foundation: 'Interesting — most people call gym an investment. You see it as non-negotiable.',
      burden: 'Paying for health and resenting it. That says something about the format, not the goal.',
    },
  },
  // Supermarkets
  {
    pattern: /tesco|mercadona|walmart|rewe|sainsbury|asda|aldi|lidl/i,
    reflections: {
      foundation: 'Groceries as foundation — straightforward. Your CFO notes the wine in there though.',
      leak: 'The weekly shop as a leak? You\'re seeing the impulse items, not just the essentials.',
      investment: 'Groceries growing your life — you eat to live well, not just to survive.',
      burden: 'When feeding yourself feels heavy, it\'s usually about more than the food.',
    },
  },
  // Ride-hailing
  {
    pattern: /uber|cabify|free\s?now|bolt/i,
    reflections: {
      foundation: 'Getting home safe — you see transport as a basic need, not an indulgence.',
      leak: 'Late-night cab as a leak. You\'re honest about convenience spending.',
      investment: 'A cab as an investment? You were protecting something — time, safety, energy.',
      burden: 'Transport that drains you. It\'s the necessity of it that stings.',
    },
  },
  // Amazon
  {
    pattern: /amazon/i,
    reflections: {
      foundation: 'Amazon as practical necessity — books and phone cases do serve a purpose.',
      leak: 'One-click buying and a feeling of waste. You\'ve noticed the pattern.',
      investment: 'Amazon as growth? The book, not the phone case, right?',
      burden: 'Amazon weighing on you — that\'s the guilt of easy spending.',
    },
  },
  // Coffee
  {
    pattern: /costa|starbucks|caf[eé]|kaffee|coffee/i,
    reflections: {
      foundation: 'A coffee before a big meeting — you see small rituals as part of how you function.',
      investment: 'Coffee as investment. You value the ritual more than the drink itself.',
      leak: 'A few quid on coffee — small, but you flagged it. You notice the details.',
      burden: 'Coffee as a burden? That\'s unusually self-aware.',
    },
  },
  // Netflix / streaming
  {
    pattern: /netflix|disney|spotify|streaming/i,
    reflections: {
      foundation: 'Shared streaming as a foundation — downtime is part of the infrastructure of life.',
      leak: 'Shared subscription, still a leak. You\'re asking if you actually use it enough.',
      investment: 'Entertainment growing your life — you get genuine value from what you watch.',
      burden: 'A subscription that weighs on you. The cost isn\'t the issue — the guilt is.',
    },
  },
  // Taxes
  {
    pattern: /council\s?tax|irpf|federal\s?tax|einkommensteuer|tax/i,
    reflections: {
      foundation: 'Tax as foundation — you see it as the price of participation. Pragmatic.',
      burden: 'Tax as burden — the most common answer. It\'s the lack of choice that stings.',
      leak: 'Tax as a leak? That\'s a distinctive worldview.',
      investment: 'Tax as investment in society. Unusual — and it says a lot about how you think.',
    },
  },
  // Wellness apps
  {
    pattern: /headspace|calm/i,
    reflections: {
      investment: 'Mental health spending as investment — even used twice. You believe in the idea.',
      leak: 'Subscribed, used it twice, and you know it. That honesty is the whole point of this exercise.',
      foundation: 'Wellness as a foundation — you think mental health is non-negotiable.',
      burden: 'Paying for calm and feeling burdened by it. There\'s irony there worth exploring.',
    },
  },
  // Clothing
  {
    pattern: /zara|h&m|uniqlo/i,
    reflections: {
      foundation: 'New clothes before an interview — practical spending with a clear purpose.',
      investment: 'Dressing well as investment — first impressions do matter.',
      leak: 'Clothes shopping as a leak. You\'re questioning whether it was the interview or the impulse.',
      burden: 'Spending on appearance and resenting it. The obligation of looking the part.',
    },
  },
  // Phone contracts
  {
    pattern: /vodafone|movistar|t-mobile|telekom|ee\b|o2/i,
    reflections: {
      foundation: 'Phone contract as foundation — connectivity is non-negotiable for you.',
      burden: 'Locked into a contract and it weighs on you. The handset repayment is the real cost.',
      leak: 'Phone bill as a leak — you suspect you\'re overpaying.',
      investment: 'Connectivity as investment — it\'s enabling something bigger in your life.',
    },
  },
  // Charity
  {
    pattern: /charity|donat|spende|ong/i,
    reflections: {
      investment: 'Charity as investment — you see giving as something that grows your world.',
      foundation: 'Giving as a foundation — it\'s wired into how you live, not a choice you make each month.',
      burden: 'Giving that weighs on you. The obligation question: do you give because you want to or because you set it up years ago?',
      leak: 'Charity as a leak is the hardest answer to give. You\'re questioning the autopilot, not the generosity.',
    },
  },
  // Cash
  {
    pattern: /atm|cash|cajero|geldautomat/i,
    reflections: {
      foundation: 'Cash as foundation — you still value having money in your pocket.',
      leak: 'Cash withdrawal, no details. The anonymity of cash is where leaks hide.',
      burden: 'Cash that drains you. It\'s the invisibility of where it went.',
      investment: 'Cash as investment? You have plans for it that a card can\'t track.',
    },
  },
  // Greggs / fast food
  {
    pattern: /greggs|chick-fil-a|b[äa]ckerei|desayuno/i,
    reflections: {
      foundation: 'Hangover food as foundation — you know yourself well.',
      leak: 'Saturday morning regret food. You\'re linking the spend to the state of mind.',
      investment: 'Comfort food as investment? You value the recovery ritual.',
      burden: 'Cheap food that still weighs on you. It\'s not about the money.',
    },
  },
  // Spotify (separate from streaming)
  {
    pattern: /spotify|apple\s?music|tidal/i,
    reflections: {
      foundation: 'Music every day — it\'s part of how you function.',
      investment: 'Music as growth — you get real value from it.',
      leak: 'Daily listening but you still called it a leak. High standards.',
      burden: 'Music shouldn\'t feel heavy. You\'re questioning the price, not the value.',
    },
  },
]

// ── Generic quadrant reflections ────────────────────────────────────────────

const GENERIC_REFLECTIONS: Record<ValueQuadrant, string[]> = {
  foundation: [
    '{merchant} in your foundations. You see this as part of how life works.',
    'You didn\'t hesitate — {merchant} is clearly a necessity in your world.',
  ],
  investment: [
    '{merchant} as growth. You\'re framing this as a choice that builds something.',
    'Investment — you believe {merchant} is earning its keep.',
  ],
  burden: [
    '{merchant} weighing on you. The obligation is what makes it heavy.',
    'You feel the cost of {merchant} — and that awareness matters.',
  ],
  leak: [
    '{merchant} didn\'t earn its place. You\'re clear-eyed about that.',
    'Leak — you\'re not fooling yourself about {merchant}.',
  ],
}

// ── Milestone reflections ───────────────────────────────────────────────────

export function getDemoMilestoneFeedback(cardNumber: number, totalCards: number, resultsSoFar: Array<{ quadrant: ValueQuadrant | null }>): string | null {
  if (cardNumber === totalCards) {
    return 'That\'s all 10. Your CFO has a clear picture now.'
  }

  if (cardNumber === 5) {
    const counts: Record<string, number> = { foundation: 0, investment: 0, burden: 0, leak: 0 }
    for (const r of resultsSoFar) {
      if (r.quadrant) counts[r.quadrant]++
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
    if (sorted[0][1] >= 3) {
      return `Halfway — ${sorted[0][1]} out of 5 in ${QUADRANTS[sorted[0][0] as ValueQuadrant].name} so far. Let's see if that holds.`
    }
    return 'Halfway. Interesting spread so far.'
  }

  return null
}

// ── Main export ─────────────────────────────────────────────────────────────

export function getDemoFeedback(ctx: DemoFeedbackContext): string {
  const { merchant, quadrant } = ctx

  // Try merchant-specific reflection
  for (const rule of MERCHANT_REFLECTIONS) {
    if (rule.pattern.test(merchant)) {
      const reflection = rule.reflections[quadrant]
      if (reflection) return reflection
    }
  }

  // Generic quadrant reflection
  const options = GENERIC_REFLECTIONS[quadrant]
  // Deterministic selection based on merchant name
  let hash = 0
  for (let i = 0; i < merchant.length; i++) {
    hash = (hash << 5) - hash + merchant.charCodeAt(i)
    hash |= 0
  }
  const idx = Math.abs(hash) % options.length
  return options[idx].replace(/{merchant}/g, merchant)
}
