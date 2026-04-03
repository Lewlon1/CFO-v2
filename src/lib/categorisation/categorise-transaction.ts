export type MerchantMapping = {
  merchant_pattern: string
  category_name: string
  source: "system" | "user" | "ai"
  profile_id: string | null
}

// Keyword heuristics: last-resort fallback when no DB pattern matches.
// Each entry's keywords are tested as substrings of the normalised merchant text.
// ORDER MATTERS: Housing must come before Travel to prevent "alquiler" (rent) being
// misclassified as Travel (which used to include it for car rental context).
const KEYWORD_RULES: Array<{ keywords: string[]; category: string }> = [
  // Housing — before Travel so "alquiler" (rent) is caught here first
  {
    keywords: [
      "rent ", "alquiler", "miete ", "mortgage", "hipoteca",
      "ibi ", "grundsteuer", "hausgeld",
    ],
    category: "Housing",
  },
  // Groceries
  {
    keywords: [
      "supermarket", "supermercado", "supermercat", "verdura", "fruta", "frutas",
      "mercado", "grocer", "grocery", "alimentaci", "alimenta",
      "deli ", "minimarket",
      // UK
      "caprabo", "mercadona", "lidl", "aldi", "eroski", "consum", "carrefour",
      "waitrose", "tesco", "sainsbury", "morrisons", "asda", "coop ",
      // Spanish
      "primaprix", " dia ", "bon preu", "condis", "simply", "ahorramas",
      "la plaza", "el jamon",
      // German
      "rewe", "edeka", "netto ", "penny ", "kaufland", "real ", "tegut", "denn's",
      // General European
      "spar ", "intermarche", "monoprix",
    ],
    category: "Groceries",
  },
  // Dining out
  {
    keywords: [
      "restaurant", "restaurante", "cafe ", "café", "cafeteria", "cafetería",
      "coffee", "bistro", "brasserie", "sushi", "pizza", "burger", "grill",
      "tapas", "mcdonald", "kfc ", "subway ", "starbucks", "costa ", "nando",
      "wagamama", "chipotle", "domino", "kebab", "pizzeria",
      "osteria", "taberna", "bodega", "cantina", "cerveceria", "bar ",
      // Italian
      "salumeria", "trattoria", "ristorante",
      // German
      "biergarten", "brauhaus", "gasthaus",
      // French
      "boulangerie", "patisserie",
      // Other
      "churros", "wok ", "thai ", "indian ", "chinese ", "ramen",
    ],
    category: "Dining out",
  },
  // Travel — "alquiler" removed (now caught by Housing above); car hire terms kept
  {
    keywords: [
      "airport", "duty free", "aeropuerto", "airline", "aerolinea",
      "ryanair", "easyjet", "vueling", "iberia", "british airway",
      "hotel", "hostel", "airbnb", "booking.com", "expedia",
      "holiday", "resort", "alojamiento",
      "rental car", "car hire",
    ],
    category: "Travel",
  },
  // Transport
  {
    keywords: [
      "petrol", "gasolina", "fuel",
      "bp ", "shell ", "texaco", "esso ", "repsol",
      "parking", "aparcamiento",
      "autobus", "metro ", "renfe", "cercanias", "trainline", "national rail",
      "taxi ", "uber ", "bolt ", "free now",
      "bus ",
      // Spanish transit
      "cabify", "tmb ", "fgc ", "tussam", "emt ",
      // German transit/rail
      "db ", "deutsche bahn", "bvg ", "mvv ", "flixbus",
    ],
    category: "Transport",
  },
  // Entertainment
  {
    keywords: [
      "golf", "tennis", "padel", "squash", "bowling", "cinema", "cine ",
      "theatre", "teatro", "museum", "museo", "zoo ", "aquarium",
      "escape room", "karting", "shooting range",
    ],
    category: "Entertainment",
  },
  // Healthcare (absorbs former Personal care)
  {
    keywords: [
      "gym ", "fitness", "crossfit", "yoga ", "pilates",
      "pharmacy", "farmacia", "chemist", "boots ", "lloyds pharmacy", "superdrug",
      "dentist", "dental", "optician", "hospital", "clinic", "clinica",
      "physio", "medic",
      // Personal care (merged in)
      "peluquer", "friseur", "haircut", "barber", "nail ", "beauty", "spa ",
      "massage", "estetica", "drogueria",
      // European personal care retailers
      "rossmann", "dm ",
    ],
    category: "Healthcare",
  },
  // Subscriptions
  {
    keywords: [
      "netflix", "spotify", "apple.com", "google play", "steam ",
      "playstation", "xbox ", "disney", "amazon prime", "prime video",
      "hbo ", "dazn", "twitch", "adobe ", "dropbox", "notion ", "1password",
    ],
    category: "Subscriptions",
  },
  // Shopping
  {
    keywords: [
      "amazon", "ebay ", "zara ", "h&m ", "mango ", "uniqlo", "ikea ",
      "el corte ingles", "corte ingles", "asos", "zalando", "decathlon",
      "leroy merlin", "fnac",
      // Extended
      "primark", "pull&bear", "bershka", "stradivarius",
      "media markt", "saturn", "douglas", "muller ", "tk maxx", "action ",
    ],
    category: "Shopping",
  },
  // Utilities
  {
    keywords: [
      "electricity", "electric", "electricidad", "gas ", "natural gas",
      "water ", "agua ", "energia", "energy",
      "broadband", "internet ", "telecomunicacion",
      "movistar", "vodafone", "orange ", "o2 ",
    ],
    category: "Utilities",
  },
  // Taxes & Government — council tax moved here from Housing
  {
    keywords: [
      "council tax", "community charge",
      "hmrc", "tax ", "dvla", "passport", "visa fee", "parking permit",
      // Spanish / European
      "hacienda", "agencia tributaria",
    ],
    category: "Taxes & Government",
  },
  // Gifts & Giving
  {
    keywords: [
      "charity", "donation", "donacion", "giving", "gift ",
      "present", "justgiving", "gofundme", "go fund me",
      "red cross", "oxfam", "save the children", "cancer research",
    ],
    category: "Gifts & Giving",
  },
  // Transfers (excluded from Value Map)
  {
    keywords: [
      "transfer", "savings pot", "isa ", "standing order",
      "internal transfer", "savings transfer",
      "moneybox", "plum ", "chip ",
    ],
    category: "Transfers",
  },
]

function keywordCategorise(merchantText: string): string | null {
  const lower = ` ${merchantText.toLowerCase()} ` // pad with spaces so word-boundary keywords work
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      return rule.category
    }
  }
  return null
}

/**
 * Categorises a transaction by matching its merchant/description text
 * against known merchant patterns. User-specific mappings take priority
 * over system defaults. Longest pattern match wins within each group.
 */
export function categoriseTransaction(
  merchantText: string,
  mappings: MerchantMapping[]
): string {
  if (!merchantText) return "Uncategorised"

  const lower = merchantText.toLowerCase()

  const userMappings = mappings.filter((m) => m.profile_id !== null)
  const systemMappings = mappings.filter((m) => m.profile_id === null)

  // User mappings first (higher priority)
  const userMatch = findLongestMatch(lower, userMappings)
  if (userMatch) return userMatch.category_name

  // Then system defaults
  const systemMatch = findLongestMatch(lower, systemMappings)
  if (systemMatch) return systemMatch.category_name

  // Finally: keyword heuristics (built-in, no DB required)
  const keywordMatch = keywordCategorise(merchantText)
  if (keywordMatch) {
    if (process.env.NODE_ENV === "development") {
      console.debug("[categorise] keyword match", { merchantText, category: keywordMatch })
    }
    return keywordMatch
  }

  if (process.env.NODE_ENV === "development") {
    console.debug("[categorise] no match", { merchantText, lower })
  }
  return "Uncategorised"
}

function findLongestMatch(
  text: string,
  mappings: MerchantMapping[]
): MerchantMapping | null {
  return (
    mappings
      .filter((m) => text.includes(m.merchant_pattern))
      .sort((a, b) => b.merchant_pattern.length - a.merchant_pattern.length)[0] ?? null
  )
}

/**
 * Batch-categorise multiple merchant texts against the same mappings.
 */
export function categoriseTransactions(
  merchantTexts: string[],
  mappings: MerchantMapping[]
): string[] {
  return merchantTexts.map((text) => categoriseTransaction(text, mappings))
}
