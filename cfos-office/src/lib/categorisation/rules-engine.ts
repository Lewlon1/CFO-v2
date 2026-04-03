import { normaliseMerchant } from './normalise-merchant'
import type { Category } from '@/lib/parsers/types'

export type CatResult = {
  categoryId: string | null
  confidence: number
  tier: 'db_example' | 'keyword' | 'none'
}

// Keyword heuristics mapped to DB category slugs.
// ORDER MATTERS: housing before transport to prevent "alquiler" (rent) mismatching.
const KEYWORD_RULES: Array<{ keywords: string[]; categoryId: string }> = [
  {
    keywords: [
      'rent ', 'alquiler', 'miete ', 'mortgage', 'hipoteca', 'ibi ', 'grundsteuer',
    ],
    categoryId: 'housing',
  },
  {
    keywords: [
      'supermarket', 'supermercado', 'mercadona', 'lidl', 'aldi', 'eroski', 'consum',
      'carrefour', 'waitrose', 'tesco', 'sainsbury', 'morrisons', 'asda', 'coop ',
      'primaprix', ' dia ', 'bon preu', 'condis', 'simply', 'ahorramas',
      'rewe', 'edeka', 'netto ', 'penny ', 'kaufland', 'spar ',
      'verdura', 'fruta', 'grocer', 'alimentaci', 'minimarket',
    ],
    categoryId: 'groceries',
  },
  {
    keywords: [
      'restaurant', 'restaurante', 'cafe ', 'café', 'cafeteria', 'cafetería', 'coffee',
      'bistro', 'brasserie', 'sushi', 'pizza', 'burger', 'grill', 'tapas',
      'mcdonald', 'kfc ', 'subway ', 'starbucks', 'costa ', 'nando', 'wagamama',
      'chipotle', 'domino', 'kebab', 'pizzeria', 'taberna', 'bodega', 'cerveceria',
      'boulangerie', 'patisserie', 'trattoria', 'ristorante', 'ramen', 'glovo',
      'deliveroo', 'ubereats', 'just eat',
    ],
    categoryId: 'eat_drinking_out',
  },
  {
    keywords: [
      'petrol', 'gasolina', 'fuel', 'bp ', 'shell ', 'texaco', 'esso ', 'repsol',
      'parking', 'aparcamiento', 'autobus', 'metro ', 'renfe', 'cercanias',
      'trainline', 'national rail', 'taxi ', 'uber ', 'bolt ', 'free now', 'cabify',
      'bus ', 'bvg ', 'flixbus', 'deutsche bahn',
    ],
    categoryId: 'transport',
  },
  {
    keywords: [
      'airport', 'aeropuerto', 'airline', 'ryanair', 'easyjet', 'vueling', 'iberia',
      'british airway', 'hotel', 'hostel', 'airbnb', 'booking.com', 'expedia',
      'holiday', 'resort', 'alojamiento',
    ],
    categoryId: 'travel',
  },
  {
    keywords: [
      'netflix', 'spotify', 'apple.com', 'google play', 'steam ',
      'playstation', 'xbox ', 'disney', 'amazon prime', 'prime video',
      'hbo ', 'dazn', 'twitch', 'adobe ', 'dropbox', 'notion ', '1password',
    ],
    categoryId: 'subscriptions',
  },
  {
    keywords: [
      'amazon', 'ebay ', 'zara ', 'h&m ', 'mango ', 'uniqlo', 'ikea ',
      'el corte ingles', 'corte ingles', 'asos', 'zalando', 'decathlon',
      'leroy merlin', 'fnac', 'primark', 'media markt',
    ],
    categoryId: 'shopping',
  },
  {
    keywords: [
      'gym ', 'fitness', 'crossfit', 'yoga ', 'pilates',
      'pharmacy', 'farmacia', 'chemist', 'boots ', 'dentist', 'dental',
      'optician', 'hospital', 'clinic', 'clinica', 'physio', 'medic',
      'peluquer', 'haircut', 'barber', 'nail ', 'beauty', 'spa ', 'massage',
    ],
    categoryId: 'health',
  },
  {
    keywords: [
      'electricity', 'electric', 'electricidad', 'gas ', 'natural gas',
      'water ', 'agua ', 'energia', 'energy', 'broadband', 'internet ',
      'movistar', 'vodafone', 'orange ', 'o2 ', 'endesa', 'iberdrola',
    ],
    categoryId: 'utilities_bills',
  },
  {
    keywords: [
      'golf', 'tennis', 'padel', 'squash', 'bowling', 'cinema', 'cine ',
      'theatre', 'teatro', 'museum', 'museo', 'zoo ', 'aquarium', 'escape room',
    ],
    categoryId: 'entertainment',
  },
  {
    keywords: ['pet food', 'vet ', 'veterinario', 'grooming', 'mascotas'],
    categoryId: 'pets',
  },
  {
    keywords: [
      'savings transfer', 'broker', 'pension', 'crypto', 'etf',
      'vanguard', 'degiro', 'trading',
    ],
    categoryId: 'savings_investments',
  },
  {
    keywords: ['loan repayment', 'credit card', 'student loan', 'prestamo'],
    categoryId: 'debt_repayments',
  },
  {
    keywords: ['salary', 'salario', 'nomina', 'nómina', 'payroll', 'dividends', 'freelance'],
    categoryId: 'income',
  },
]

/**
 * Tier 1: Match description against category examples[] from DB.
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
    return { categoryId: bestMatch.categoryId, confidence: 1.0, tier: 'db_example' }
  }
  return { categoryId: null, confidence: 0, tier: 'none' }
}

/**
 * Tier 2: Keyword heuristics.
 */
function matchByKeywords(paddedText: string): CatResult {
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((kw) => paddedText.includes(kw))) {
      return { categoryId: rule.categoryId, confidence: 0.8, tier: 'keyword' }
    }
  }
  return { categoryId: null, confidence: 0, tier: 'none' }
}

/**
 * Run tiers 1 and 2. Returns null categoryId if no match (needs LLM tier 3).
 */
export function categoriseByRules(description: string, categories: Category[]): CatResult {
  const normalised = normaliseMerchant(description)
  const t1 = matchByExamples(normalised, categories)
  if (t1.categoryId) return t1
  const padded = ` ${normalised} `
  return matchByKeywords(padded)
}
