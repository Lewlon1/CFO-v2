import { normaliseMerchant } from './normalise-merchant'
import type { Category, UserMerchantRule, RecurringMatch } from '@/lib/parsers/types'

export type CatResult = {
  categoryId: string | null
  confidence: number
  tier: 'user_rule' | 'recurring' | 'db_example' | 'keyword' | 'none'
}

export type RulesContext = {
  categories: Category[]
  amount?: number
  userMerchantRules?: UserMerchantRule[]
  recurringExpenses?: RecurringMatch[]
}

// Keyword heuristics mapped to DB category slugs.
// ORDER MATTERS:
//   - Transfers first: "deposit", "withdrawal" shouldn't get mis-classified as spending/income.
//   - Housing before transport to prevent "alquiler" (rent) mismatching.
const KEYWORD_RULES: Array<{ keywords: string[]; categoryId: string }> = [
  {
    keywords: [
      'transfer to pot', 'transfer from pot', 'pot transfer',
      'to eur', 'to gbp', 'to usd', 'exchanged to',
      'withdrawal', 'deposit ', 'internet transfer',
      'p2p payment', 'bank transfer',
    ],
    categoryId: 'transfers',
  },
  {
    keywords: [
      'rent ', 'alquiler', 'miete ', 'mortgage', 'hipoteca', 'ibi ', 'grundsteuer',
      'home insurance', 'seguro hogar', 'maintenance', 'mantenimiento',
      'community fees', 'comunidad', 'homeowner', 'scanlans',
    ],
    categoryId: 'housing',
  },
  {
    keywords: [
      'supermarket', 'supermercado', 'mercadona', 'lidl', 'aldi', 'eroski', 'consum',
      'carrefour', 'waitrose', 'tesco', 'sainsbury', 'morrisons', 'asda', 'coop ',
      'co-op', 'co-operative', 'iceland ', 'ocado', 'marks & spencer', 'm&s food',
      'primaprix', ' dia ', 'bon preu', 'condis', 'simply', 'ahorramas',
      'caprabo', 'supermercat', 'mercalatina',
      'rewe', 'edeka', 'netto ', 'penny ', 'kaufland', 'spar ',
      'verdura', 'fruta', 'grocer', 'alimentaci', 'minimarket',
    ],
    categoryId: 'groceries',
  },
  {
    keywords: [
      'restaurant', 'restaurante', 'cafe ', 'café', 'cafeteria', 'cafetería', 'coffee',
      'coffee shop', 'bistro', 'brasserie', 'sushi', 'pizza', 'burger', 'grill', 'tapas',
      'mcdonald', 'kfc ', 'subway ', 'starbucks', 'costa ', 'nando', 'wagamama',
      'popeyes', 'greggs', 'pret', 'pret a manger',
      'chipotle', 'domino', 'kebab', 'pizzeria', 'taberna', 'bodega', 'cerveceria',
      'boulangerie', 'patisserie', 'trattoria', 'ristorante', 'ramen', 'glovo',
      'deliveroo', 'ubereats', 'uber eats', 'just eat', 'pub ', 'bar ', 'wetherspoon',
      'pan laude', 'red lion', 'mollys',
    ],
    categoryId: 'eat_drinking_out',
  },
  {
    keywords: [
      'petrol', 'gasolina', 'fuel', 'bp ', 'shell ', 'texaco', 'esso ', 'repsol',
      'parking', 'aparcamiento', 'autobus', 'metro ', 'renfe', 'cercanias',
      'trainline', 'national rail', 'tfl', 'transport for london',
      'taxi ', 'uber ', 'bolt ', 'free now', 'cabify',
      'bus ', 'bvg ', 'flixbus', 'deutsche bahn',
      'car insurance', 'seguro coche', 'toll ', 'peaje',
    ],
    categoryId: 'transport',
  },
  {
    keywords: [
      'airport', 'aeropuerto', 'airline', 'ryanair', 'easyjet', 'vueling', 'iberia',
      'british airway', 'hotel', 'hostel', 'airbnb', 'booking.com', 'expedia',
      'holiday', 'resort', 'alojamiento', 'travel insurance', 'seguro viaje',
    ],
    categoryId: 'travel',
  },
  {
    keywords: [
      'netflix', 'spotify', 'apple.com', 'google play', 'google storage', 'steam ',
      'playstation', 'xbox ', 'disney', 'disney+', 'disney plus', 'amazon prime', 'prime video',
      'hbo ', 'dazn', 'twitch', 'adobe ', 'dropbox', 'notion ', '1password',
      'icloud', 'youtube premium', 'chatgpt', 'openai', 'github',
      'claude.ai', 'anthropic', 'supabase', 'perplexity',
    ],
    categoryId: 'subscriptions',
  },
  {
    keywords: [
      'amazon', 'ebay ', 'zara ', 'h&m ', 'mango ', 'uniqlo', 'ikea ',
      'el corte ingles', 'corte ingles', 'asos', 'zalando', 'decathlon',
      'leroy merlin', 'fnac', 'primark', 'media markt',
      'john lewis', 'argos', 'tk maxx', 'tkmaxx',
      'aliexpress', 'shein', 'temu', 'arbitrade', 'humana',
    ],
    categoryId: 'shopping',
  },
  {
    keywords: [
      'gym ', 'puregym', 'the gym', 'fitness', 'crossfit', 'yoga ', 'pilates',
      'pharmacy', 'farmacia', 'chemist', 'boots ', 'dentist', 'dental',
      'optician', 'hospital', 'clinic', 'clinica', 'physio', 'medic',
      'doctor', 'supplement', 'vitamins', 'nhs ',
      'peluquer', 'haircut', 'barber', 'nail ', 'beauty', 'spa ', 'massage',
      'skincare', 'cosmetic',
    ],
    categoryId: 'health',
  },
  {
    keywords: [
      'electricity', 'electric', 'electricidad', 'gas ', 'natural gas',
      'water ', 'agua ', 'energia', 'energy', 'broadband', 'internet ',
      'movistar', 'vodafone', 'orange ', 'o2 ', ' ee ', 'three ', 'giffgaff',
      'bt ', 'sky ', 'virgin media',
      'british gas', 'octopus energy', 'bulb ', 'ovo energy', 'ovo ',
      'hyperoptic', 'zurich',
      'council tax', 'manchester city council',
      'endesa', 'iberdrola',
      'mobile plan', 'telefonica', 'jazztel', 'masmovil', 'digi ',
    ],
    categoryId: 'utilities_bills',
  },
  {
    keywords: [
      'golf', 'tennis', 'padel', 'playtomic', 'squash', 'bowling', 'cinema', 'cine ',
      'theatre', 'teatro', 'museum', 'museo', 'zoo ', 'aquarium', 'escape room',
      'ski ', 'concert', 'event', 'ticket',
    ],
    categoryId: 'entertainment',
  },
  {
    keywords: [
      'pet food', 'vet ', 'veterinario', 'grooming', 'mascotas',
      'petshop', 'kiwoko', 'tiendanimal',
    ],
    categoryId: 'pets',
  },
  {
    keywords: [
      'savings transfer', 'broker', 'pension', 'crypto', 'bitcoin', 'etf',
      'vanguard', 'degiro', 'trading', 'etoro', 'interactive brokers', 'myinvestor',
    ],
    categoryId: 'savings_investments',
  },
  {
    keywords: [
      'loan repayment', 'credit card', 'student loan', 'prestamo',
      'natwest loan', 'natwest credit',
    ],
    categoryId: 'debt_repayments',
  },
  {
    keywords: [
      'salary', 'salario', 'nomina', 'nómina', 'payroll', 'dividends', 'freelance',
      'side income', 'rental income', 'refund', 'interest for',
    ],
    categoryId: 'income',
  },
]

// Supermarket merchants that get amount-based confidence adjustment
const GROCERY_MERCHANTS = [
  'mercadona', 'lidl', 'aldi', 'eroski', 'carrefour', 'consum',
  'waitrose', 'tesco', 'sainsbury', 'morrisons', 'asda',
  'rewe', 'edeka', 'kaufland',
]

/**
 * Tier 1: Match against user-learned merchant rules.
 */
function matchByUserRules(
  normalisedText: string,
  rules: UserMerchantRule[]
): CatResult {
  for (const rule of rules) {
    if (normalisedText === rule.normalised_merchant ||
        normalisedText.includes(rule.normalised_merchant)) {
      return { categoryId: rule.category_id, confidence: rule.confidence, tier: 'user_rule' }
    }
  }
  return { categoryId: null, confidence: 0, tier: 'none' }
}

/**
 * Tier 2: Match against recurring expenses with known categories.
 */
function matchByRecurring(
  normalisedText: string,
  recurring: RecurringMatch[]
): CatResult {
  for (const rec of recurring) {
    if (rec.category_id && normalisedText === rec.name) {
      return { categoryId: rec.category_id, confidence: 0.9, tier: 'recurring' }
    }
  }
  return { categoryId: null, confidence: 0, tier: 'none' }
}

/**
 * Tier 3: Match description against category examples[] from DB.
 * Longest match wins.
 */
function matchByExamples(normalisedText: string, categories: Category[]): CatResult {
  let bestMatch: { categoryId: string; matchLength: number } | null = null

  for (const cat of categories) {
    for (const example of cat.examples) {
      const exLower = example.toLowerCase()
      if (normalisedText.includes(exLower)) {
        if (!bestMatch || exLower.length > bestMatch.matchLength) {
          bestMatch = { categoryId: cat.id, matchLength: exLower.length }
        }
      }
    }
  }

  if (bestMatch) {
    return { categoryId: bestMatch.categoryId, confidence: 0.9, tier: 'db_example' }
  }
  return { categoryId: null, confidence: 0, tier: 'none' }
}

/**
 * Tier 4: Keyword heuristics with amount-based confidence for groceries.
 */
function matchByKeywords(paddedText: string, amount?: number): CatResult {
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((kw) => paddedText.includes(kw))) {
      let confidence = 0.8

      // Amount heuristic for grocery merchants
      if (rule.categoryId === 'groceries' && amount !== undefined) {
        const isKnownGrocery = GROCERY_MERCHANTS.some((m) => paddedText.includes(m))
        if (isKnownGrocery) {
          confidence = Math.abs(amount) < 200 ? 0.9 : 0.7
        }
      }

      return { categoryId: rule.categoryId, confidence, tier: 'keyword' }
    }
  }
  return { categoryId: null, confidence: 0, tier: 'none' }
}

/**
 * Run all tiers in priority order. Returns null categoryId if no match (needs LLM).
 *
 * Priority:
 *   1. User merchant rules (confidence 0.95)
 *   2. Recurring expense match (confidence 0.9)
 *   3. DB example match (confidence 0.9)
 *   4. Keyword heuristics (confidence 0.6-0.9)
 *   5. No match → LLM batch
 */
export function categoriseByRules(
  description: string,
  contextOrCategories: RulesContext | Category[]
): CatResult {
  const context: RulesContext = Array.isArray(contextOrCategories)
    ? { categories: contextOrCategories }
    : contextOrCategories

  const normalised = normaliseMerchant(description)
  const padded = ` ${normalised} `

  // Tier 1: User-learned rules
  if (context.userMerchantRules && context.userMerchantRules.length > 0) {
    const t1 = matchByUserRules(normalised, context.userMerchantRules)
    if (t1.categoryId) return t1
  }

  // Tier 2: Recurring expense inheritance
  if (context.recurringExpenses && context.recurringExpenses.length > 0) {
    const t2 = matchByRecurring(normalised, context.recurringExpenses)
    if (t2.categoryId) return t2
  }

  // Tier 3: DB examples
  const t3 = matchByExamples(normalised, context.categories)
  if (t3.categoryId) return t3

  // Tier 4: Keywords with amount heuristics
  return matchByKeywords(padded, context.amount)
}
