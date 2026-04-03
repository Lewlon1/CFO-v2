import type { ValueQuadrant, ValueMapTransaction, ValueMapResult } from './types'
import { QUADRANTS } from './constants'

// ── Feedback rules engine ────────────────────────────────────────────────────
//
// Three-tier lookup:
//   1. Specific merchant pattern → quadrant → feedback
//   2. Category fallback → quadrant → feedback
//   3. Generic quadrant fallback (always references merchant/amount)
//
// Every message templates {merchant}, {amount}, {currency}.
// "Good choice!" is never acceptable.

interface FeedbackContext {
  merchant: string | null
  amount: number
  quadrant: ValueQuadrant
  currency: string
  isRecurring: boolean
  description: string | null
  categoryName: string | null
}

// ── Tier 1: Merchant-specific rules ──────────────────────────────────────────

interface MerchantRule {
  pattern: RegExp
  feedback: Partial<Record<ValueQuadrant, string>>
}

const MERCHANT_RULES: MerchantRule[] = [
  // Food delivery
  {
    pattern: /deliveroo|uber\s?eats|just\s?eat/i,
    feedback: {
      leak: '{merchant} at that hour — rarely a planned meal.',
      foundation: '{currency}{amount} on {merchant}. Even foundations can be optimised — cooking wins here.',
      investment: '{merchant} as an investment? Must have been a special occasion.',
      burden: '{currency}{amount} on {merchant} feels like a burden? Time to delete the app.',
    },
  },
  // Gyms
  {
    pattern: /gym|puregym|the\s?gym|david\s?lloyd|virgin\s?active|nuffield|anytime\s?fitness/i,
    feedback: {
      investment: '{currency}{amount}/month for your health — that\'s a solid investment.',
      leak: 'Ouch. When did you last actually go?',
      foundation: 'Health as a foundation — most people put this in Investment. Either way, it\'s money well spent.',
      burden: '{currency}{amount}/month and it feels heavy? There are cheaper ways to stay active.',
    },
  },
  // Rent / mortgage
  {
    pattern: /^rent$|mortgage|housing/i,
    feedback: {
      foundation: 'Your biggest foundation cost. Location matters — is yours working for you?',
      burden: 'Interesting — you see this as a burden, not a foundation. Is it the amount, the location, or the value you\'re getting?',
      investment: 'Seeing housing as an investment — that\'s a property owner\'s mindset.',
      leak: '{currency}{amount} on housing feels like a leak? That\'s worth a real conversation.',
    },
  },
  // Supermarkets
  {
    pattern: /sainsbury|tesco|asda|aldi|lidl|waitrose|m&s food|morrisons|co-?op/i,
    feedback: {
      foundation: 'Feeding yourself well — that\'s a foundation cost that pays dividends.',
      leak: '{currency}{amount} at {merchant}. The trolley has a way of filling itself.',
      investment: '{merchant} as an investment? You must be eating very well.',
      burden: 'Groceries shouldn\'t feel like a burden. Worth checking if you\'re shopping smart.',
    },
  },
  // Pubs / bars
  {
    pattern: /pub|bar|the\s?crown|wetherspoon|greene\s?king/i,
    feedback: {
      leak: '{currency}{amount} at {merchant}. The first couple of rounds are the relationship investment. The rest...',
      investment: 'Social spending as investment — your CFO agrees, up to a point.',
      foundation: '{merchant} as a foundation? Everyone needs a local.',
      burden: '{currency}{amount} at the pub and it weighs on you. That\'s honest.',
    },
  },
  // Streaming
  {
    pattern: /netflix|disney\+?|prime\s?video|now\s?tv|apple\s?tv|paramount/i,
    feedback: {
      leak: '{currency}{amount}/month. Small enough to forget, big enough to add up over a year.',
      foundation: 'Streaming as a foundation — everyone needs downtime.',
      investment: '{merchant} growing your life? Must be some good documentaries.',
      burden: '{currency}{amount}/month shouldn\'t feel heavy. Cancel what you don\'t watch.',
    },
  },
  // Music streaming
  {
    pattern: /spotify|apple\s?music|youtube\s?music|tidal|deezer/i,
    feedback: {
      foundation: '{currency}{amount} for a soundtrack to your life. Fair.',
      leak: '{currency}{amount}/month on {merchant}. When did you last discover something new on it?',
      investment: 'Music as investment — your CFO won\'t argue with that.',
      burden: '{currency}{amount}/month for music shouldn\'t feel heavy. Family plan?',
    },
  },
  // Bank fees
  {
    pattern: /overdraft|bank\s?fee|hsbc|barclays|natwest|lloyds|halifax/i,
    feedback: {
      burden: '{currency}{amount} the bank took from you. That\'s {currency}{annualised}/year for nothing.',
      leak: '{currency}{amount} in bank fees — money that bought you absolutely nothing.',
      foundation: 'Bank fees as a foundation? Your CFO respectfully disagrees.',
      investment: 'Bank fees as an investment? Let\'s talk.',
    },
  },
  // Education
  {
    pattern: /udemy|coursera|skillshare|masterclass|brilliant|duolingo/i,
    feedback: {
      investment: 'Investing in yourself. The ROI is infinite — if you actually finish it.',
      foundation: 'Education as a foundation — strong move.',
      leak: '{currency}{amount} on {merchant}. Did you finish the course? Be honest.',
      burden: 'Learning shouldn\'t feel like a burden. Maybe the format isn\'t right?',
    },
  },
  // Therapy / mental health
  {
    pattern: /betterhelp|therapy|counselling|headspace|calm/i,
    feedback: {
      investment: '{currency}{amount} on mental health. The best investment most people never make.',
      foundation: 'Mental health as a foundation — it underpins everything else.',
      burden: 'Therapy feeling like a burden is worth discussing with your therapist.',
      leak: 'If this feels like a leak, it might be the provider, not the practice.',
    },
  },
  // Travel / flights
  {
    pattern: /ryanair|easyjet|british\s?airways|ba\b|wizz\s?air|tui|booking\.com|airbnb|skyscanner/i,
    feedback: {
      investment: '{currency}{amount} on travel. Experiences over things — your CFO approves.',
      leak: '{currency}{amount} on {merchant}. Was this planned or a 2am impulse booking?',
      foundation: 'Travel as a foundation — visiting family?',
      burden: '{currency}{amount} on travel and it hurts. The trip better be worth it.',
    },
  },
  // Fast fashion / clothing
  {
    pattern: /zara|h&m|primark|asos|shein|boohoo|plt|uniqlo/i,
    feedback: {
      leak: '{currency}{amount} at {merchant}. How many of these purchases are still in the bag?',
      investment: 'Wardrobe as investment — dressing well does open doors.',
      foundation: '{merchant} as a foundation? Everyone needs clothes, but this is worth watching.',
      burden: '{currency}{amount} on clothes and it weighs on you. That\'s a clear signal.',
    },
  },
  // Amazon
  {
    pattern: /amazon/i,
    feedback: {
      leak: '{currency}{amount} on Amazon. The one-click checkout is designed to prevent exactly this kind of reflection.',
      foundation: 'Amazon as a foundation — practical purchases add up fast.',
      investment: '{merchant} growing your life? Depends what\'s in the box.',
      burden: 'Amazon as a burden — you might have a Prime problem.',
    },
  },
  // Phone / broadband
  {
    pattern: /ee\b|o2\b|vodafone|three\b|sky\b|bt\b|virgin\s?media|broadband|mobile\s?contract/i,
    feedback: {
      foundation: '{currency}{amount}/month for connectivity. Foundation, but are you on the best deal?',
      burden: '{currency}{amount}/month on {merchant} feels heavy. When does the contract end?',
      leak: '{currency}{amount}/month on {merchant}. SIM-only deals could halve this.',
      investment: 'Connectivity as investment — fair, if it\'s enabling something bigger.',
    },
  },
  // Insurance
  {
    pattern: /insurance|aviva|admiral|direct\s?line|compare\s?the\s?market/i,
    feedback: {
      foundation: 'Insurance is the definition of foundation spending. Just don\'t auto-renew blindly.',
      burden: '{currency}{amount} on insurance hurts. When did you last compare quotes?',
      leak: 'Insurance as a leak? Either you\'re over-insured or under-claiming.',
      investment: 'Insurance as investment — the best investment is the one you never need to claim.',
    },
  },
  // Coffee shops
  {
    pattern: /costa|starbucks|pret|caffe\s?nero|greggs|coffee/i,
    feedback: {
      leak: '{currency}{amount} on {merchant}. Multiply that by 5 days a week.',
      foundation: '{merchant} as a morning foundation — your CFO gets it, but a flask saves you {currency}{annualised}/year.',
      investment: 'Coffee as an investment? Only if it came with a great conversation.',
      burden: '{currency}{amount} on coffee shouldn\'t be a burden. Make it at home?',
    },
  },
  // Energy
  {
    pattern: /energy|electric|gas|octopus|british\s?gas|eon|edf|bulb|ovo/i,
    feedback: {
      foundation: 'Energy is the most foundational cost there is. Have you compared tariffs lately?',
      burden: 'Energy bills as a burden — you\'re not alone. Fixed-rate deals can help.',
      leak: 'Energy as a leak? That\'s unusual. Might be worth an energy audit.',
      investment: 'Investing in energy? Smart if it\'s solar panels. Otherwise, let\'s talk.',
    },
  },
]

// ── Tier 2: Category-based fallback ──────────────────────────────────────────

const CATEGORY_RULES: Record<string, Partial<Record<ValueQuadrant, string>>> = {
  groceries: {
    foundation: '{currency}{amount} on groceries — feeding yourself is the most basic foundation.',
    leak: '{currency}{amount} on groceries felt wasteful? Meal planning could help.',
    investment: 'Eating well is investing in your energy. Just watch the impulse aisle.',
    burden: 'Groceries as a burden — are you shopping for more mouths than your own?',
  },
  dining: {
    foundation: '{currency}{amount} eating out. Everyone needs a break from cooking.',
    leak: '{currency}{amount} eating out. Was this hunger or habit?',
    investment: '{currency}{amount} on a meal. Social spending builds relationships — if it was social.',
    burden: '{currency}{amount} on dining and it hurts. Cooking more could free up a lot.',
  },
  housing: {
    foundation: 'Housing — the biggest line in anyone\'s budget. Foundation by default.',
    burden: 'Housing costs weighing you down. Worth exploring if there\'s a more efficient option.',
    leak: 'Housing as a leak is rare but real. Paying for space you don\'t use?',
    investment: 'Treating housing as an investment — the property-minded approach.',
  },
  transport: {
    foundation: '{currency}{amount} on transport. Getting where you need to be — that\'s foundational.',
    burden: 'Transport costs as a burden. Remote work, carpooling, or cycling could shift this.',
    leak: '{currency}{amount} on transport you didn\'t need? Taxis add up fast.',
    investment: 'Transport as investment — if it\'s getting you to something valuable.',
  },
  subscriptions: {
    foundation: '{currency}{amount}/month on subscriptions. Necessary ones are fine — the forgotten ones aren\'t.',
    leak: '{currency}{amount}/month. When did you last actually use this?',
    investment: 'A subscription that grows you — rare but real.',
    burden: '{currency}{amount}/month on subscriptions shouldn\'t hurt. Audit time.',
  },
  shopping: {
    foundation: '{currency}{amount} on shopping. Practical purchases?',
    leak: '{currency}{amount} on shopping. The question is: would you buy it again today?',
    investment: '{currency}{amount} on something that improves your life. Quality matters.',
    burden: '{currency}{amount} on shopping that weighs on you. Return window still open?',
  },
  'health & fitness': {
    investment: '{currency}{amount} on health. The best investment you can make.',
    foundation: 'Health spending as a foundation — your future self thanks you.',
    leak: '{currency}{amount} on health and it feels wasted? The tool is only as good as the habit.',
    burden: 'Health costs shouldn\'t feel heavy. Explore if there\'s a more affordable route.',
  },
  education: {
    investment: 'Education spending — compound returns on knowledge.',
    foundation: 'Learning as a foundation — strong position.',
    leak: '{currency}{amount} on education. The value is in the completion.',
    burden: 'Education feeling like a burden? The format might not be right for you.',
  },
  'bank fees': {
    burden: '{currency}{amount} in bank fees. That\'s money that bought you nothing.',
    leak: '{currency}{amount} in fees — a silent drain on your finances.',
    foundation: 'Bank fees are never a foundation. Let\'s fix this.',
    investment: 'Bank fees as an investment? Your CFO would like a word.',
  },
  'gifts & giving': {
    investment: '{currency}{amount} on giving. Generosity is an investment in relationships and community.',
    foundation: 'Giving as a foundation — that says something good about your values.',
    leak: '{currency}{amount} on giving that felt wasteful? Maybe it\'s the cause, not the act.',
    burden: '{currency}{amount} on giving and it weighs on you. Generosity should feel good — if it doesn\'t, set a budget.',
  },
  'taxes & government': {
    foundation: '{currency}{amount} on taxes. The price of participation — a true foundation cost.',
    burden: '{currency}{amount} in tax-related costs. The burden framing is honest — but are you using all available reliefs?',
    leak: 'Government costs as a leak? Worth checking if you\'re paying for things you don\'t need to.',
    investment: 'Tax as investment — an unusual take. Are you in a country with good public services?',
  },
}

// ── Tier 3: Generic quadrant fallback ────────────────────────────────────────
// Always references merchant and amount — never generic.

const GENERIC_FEEDBACK: Record<ValueQuadrant, string[]> = {
  foundation: [
    '{currency}{amount} at {merchant}. A necessary cost — but necessary doesn\'t mean non-negotiable.',
    '{merchant} in your foundations. Solid, but worth reviewing annually.',
    '{currency}{amount} at {merchant}. Foundation spending keeps life running.',
  ],
  investment: [
    '{currency}{amount} at {merchant}. Spending that grows your life — your CFO approves.',
    '{merchant} as an investment. If it\'s building something, keep going.',
    '{currency}{amount} on {merchant}. Money spent on growth is rarely wasted.',
  ],
  burden: [
    '{currency}{amount} at {merchant} feels heavy. Can any of this be reduced or eliminated?',
    '{merchant} weighing on you. Your CFO will look for ways to lighten this.',
    '{currency}{amount} at {merchant}. Necessary burdens deserve a second look.',
  ],
  leak: [
    '{currency}{amount} at {merchant}. Worth asking — did this actually improve your day?',
    '{merchant} landed in the leak zone. No judgment, but your CFO noticed.',
    '{currency}{amount} at {merchant}. This is where small changes make the biggest difference.',
  ],
}

// ── Template resolution ──────────────────────────────────────────────────────

function formatCurrency(amount: number, currency: string): string {
  const symbols: Record<string, string> = {
    GBP: '\u00A3',
    USD: '$',
    EUR: '\u20AC',
  }
  const symbol = symbols[currency] ?? currency + ' '
  return `${symbol}${amount.toLocaleString('en', { minimumFractionDigits: amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`
}

function resolveFeedback(template: string, ctx: FeedbackContext): string {
  const merchant = ctx.merchant ?? 'this transaction'
  const formatted = formatCurrency(ctx.amount, ctx.currency)
  const annualised = formatCurrency(ctx.amount * 12, ctx.currency)

  return template
    .replace(/{merchant}/g, merchant)
    .replace(/{amount}/g, ctx.amount.toLocaleString('en', { minimumFractionDigits: ctx.amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 }))
    .replace(/{currency}/g, ({ GBP: '\u00A3', USD: '$', EUR: '\u20AC' }[ctx.currency] ?? ctx.currency + ' '))
    .replace(/{formatted}/g, formatted)
    .replace(/{annualised}/g, annualised)
}

// ── Main export ──────────────────────────────────────────────────────────────

export function getFeedback(ctx: FeedbackContext): string {
  const { merchant, quadrant, categoryName } = ctx

  // Tier 1: merchant-specific
  if (merchant) {
    for (const rule of MERCHANT_RULES) {
      if (rule.pattern.test(merchant)) {
        const template = rule.feedback[quadrant]
        if (template) return resolveFeedback(template, ctx)
      }
    }
  }

  // Tier 2: category-based
  if (categoryName) {
    const key = categoryName.toLowerCase()
    const catRule = CATEGORY_RULES[key]
    if (catRule) {
      const template = catRule[quadrant]
      if (template) return resolveFeedback(template, ctx)
    }
  }

  // Tier 3: generic quadrant — rotate through options
  const options = GENERIC_FEEDBACK[quadrant]
  const idx = Math.abs(hashStr(merchant ?? ctx.description ?? ctx.amount.toString())) % options.length
  return resolveFeedback(options[idx], ctx)
}

// Simple string hash for deterministic generic selection
function hashStr(s: string): number {
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i)
    hash |= 0
  }
  return hash
}

// ── Pattern-aware milestone feedback ────────────────────────────────────────

export interface MilestoneContext {
  cardNumber: number          // 1-indexed
  totalCards: number
  resultsSoFar: ValueMapResult[]
  transactions: ValueMapTransaction[]  // parallel array for category lookups
}

function getDominantQuadrant(results: ValueMapResult[]): { quadrant: ValueQuadrant; count: number } | null {
  const decided = results.filter((r) => r.quadrant !== null)
  if (decided.length === 0) return null

  const counts: Record<string, number> = {}
  for (const r of decided) {
    counts[r.quadrant!] = (counts[r.quadrant!] ?? 0) + 1
  }

  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  return { quadrant: entries[0][0] as ValueQuadrant, count: entries[0][1] }
}

function findContradiction(
  results: ValueMapResult[],
  transactions: ValueMapTransaction[],
): { merchantA: string; quadrantA: string; merchantB: string; quadrantB: string; category: string } | null {
  // Build a category lookup from transactions
  const categoryByTxId = new Map<string, string>()
  for (const tx of transactions) {
    if (tx.category_name) categoryByTxId.set(tx.id, tx.category_name)
  }

  const decided = results.filter((r) => r.quadrant !== null)

  for (let i = 0; i < decided.length; i++) {
    const catI = categoryByTxId.get(decided[i].transaction_id)
    if (!catI) continue

    for (let j = i + 1; j < decided.length; j++) {
      const catJ = categoryByTxId.get(decided[j].transaction_id)
      if (catJ === catI && decided[i].quadrant !== decided[j].quadrant) {
        return {
          merchantA: decided[i].merchant,
          quadrantA: QUADRANTS[decided[i].quadrant!].name,
          merchantB: decided[j].merchant,
          quadrantB: QUADRANTS[decided[j].quadrant!].name,
          category: catI,
        }
      }
    }
  }

  return null
}

/**
 * Returns a milestone comment at cards 5, 10, and the final card.
 * Appended to the standard merchant feedback as one additional sentence.
 */
export function getMilestoneFeedback(ctx: MilestoneContext): string | null {
  const { cardNumber, totalCards, resultsSoFar, transactions } = ctx

  if (cardNumber === totalCards) {
    return 'Last one. I\'ve got a clear picture of how you think about money. Let me show you.'
  }

  if (cardNumber === 5) {
    const dominant = getDominantQuadrant(resultsSoFar)
    if (!dominant) return null
    return `Interesting — ${dominant.count} of your first 5 landed in ${QUADRANTS[dominant.quadrant].name}. Let's see if that holds.`
  }

  if (cardNumber === 10) {
    const contradiction = findContradiction(resultsSoFar, transactions)
    if (contradiction) {
      return `You put ${contradiction.merchantA} in ${contradiction.quadrantA} but ${contradiction.merchantB} in ${contradiction.quadrantB} — and they're both ${contradiction.category}. Context matters to you.`
    }

    const dominant = getDominantQuadrant(resultsSoFar)
    if (!dominant) return null
    return `Your ${QUADRANTS[dominant.quadrant].name} is building — ${dominant.count} out of 10 so far.`
  }

  return null
}
