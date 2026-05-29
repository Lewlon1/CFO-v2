import type { Persona } from './types'

// Zane — Spain / EUR (Session 32 C, persona expansion).
//
// 30yo Spanish resident, paid in EUR, transacting with Spanish merchants
// (Mercadona, Carrefour, Endesa, Movistar). Tests:
//   - Currency handling (EUR amounts, EUR symbol used in the read)
//   - Merchant name normalisation for Spanish-language descriptions
//   - Bill timing — Spanish utilities bill bi-monthly (luz, agua)
//   - The CFO should not assume monthly billing for electricity
//
// Differs from drifter-expat (the existing EUR persona): Zane is a Spanish
// native with Spanish bank account quirks, not a UK expat. Bills and
// merchant landscape are different.

const csvRows: string[] = [
  'Type,Started Date,Description,Amount,Currency,Balance',
  // Nómina (salary) — last working day of the month
  'TRANSFER,2026-01-30,Nómina Consultora Diseño SL,2350.00,EUR,2350.00',
  'TRANSFER,2026-02-27,Nómina Consultora Diseño SL,2350.00,EUR,2100.00',
  'TRANSFER,2026-03-28,Nómina Consultora Diseño SL,2350.00,EUR,1980.00',

  // Alquiler (rent) — every 1st
  'CARD_PAYMENT,2026-01-01,Alquiler — Calle Doctor Esquerdo,-820.00,EUR,1530.00',
  'CARD_PAYMENT,2026-02-01,Alquiler — Calle Doctor Esquerdo,-820.00,EUR,1280.00',
  'CARD_PAYMENT,2026-03-01,Alquiler — Calle Doctor Esquerdo,-820.00,EUR,1160.00',

  // Luz (electricity) — BI-MONTHLY in Spain
  'CARD_PAYMENT,2026-01-15,Endesa Energía,-118.40,EUR,0.00',
  'CARD_PAYMENT,2026-03-12,Endesa Energía,-132.20,EUR,0.00',

  // Agua (water) — TRI-MONTHLY
  'CARD_PAYMENT,2026-01-22,Canal de Isabel II,-48.60,EUR,0.00',

  // Comunidad de vecinos (HOA) — monthly
  'CARD_PAYMENT,2026-01-05,Comunidad de propietarios,-65.00,EUR,0.00',
  'CARD_PAYMENT,2026-02-05,Comunidad de propietarios,-65.00,EUR,0.00',
  'CARD_PAYMENT,2026-03-05,Comunidad de propietarios,-65.00,EUR,0.00',

  // Internet + móvil — Movistar (combined plan)
  'CARD_PAYMENT,2026-01-10,Movistar Fusión,-58.00,EUR,0.00',
  'CARD_PAYMENT,2026-02-10,Movistar Fusión,-58.00,EUR,0.00',
  'CARD_PAYMENT,2026-03-10,Movistar Fusión,-58.00,EUR,0.00',

  // Compra semanal — Mercadona is the dominant grocery
  ...['2026-01-04', '2026-01-11', '2026-01-18', '2026-01-25', '2026-02-01', '2026-02-08', '2026-02-15', '2026-02-22', '2026-03-01', '2026-03-08', '2026-03-15', '2026-03-22', '2026-03-29'].map(
    (d, i) => `CARD_PAYMENT,${d},Mercadona,-${(48 + ((i * 4) % 18)).toFixed(2)},EUR,0.00`,
  ),

  // Mercado y panadería — small frequent (deterministic amounts)
  ...['2026-01-07', '2026-01-14', '2026-02-04', '2026-02-18', '2026-03-04', '2026-03-18'].map(
    (d, i) => `CARD_PAYMENT,${d},Panadería La Mallorquina,-${(6.5 + i * 0.4).toFixed(2)},EUR,0.00`,
  ),

  // Restaurantes — weekend menú del día + occasional dinner
  ...['2026-01-11', '2026-01-25', '2026-02-08', '2026-02-22', '2026-03-08', '2026-03-22'].map(
    (d) => `CARD_PAYMENT,${d},Casa Lucio,-32.00,EUR,0.00`,
  ),
  ...['2026-01-18', '2026-02-15', '2026-03-15'].map(
    (d) => `CARD_PAYMENT,${d},Sala de Despiece,-58.00,EUR,0.00`,
  ),

  // Transporte público — abono mensual
  'CARD_PAYMENT,2026-01-02,Abono Transporte Madrid,-54.60,EUR,0.00',
  'CARD_PAYMENT,2026-02-02,Abono Transporte Madrid,-54.60,EUR,0.00',
  'CARD_PAYMENT,2026-03-02,Abono Transporte Madrid,-54.60,EUR,0.00',

  // Café diario — Toma
  ...['2026-01-06', '2026-01-13', '2026-01-20', '2026-01-27', '2026-02-03', '2026-02-10', '2026-02-17', '2026-02-24', '2026-03-03', '2026-03-10', '2026-03-17', '2026-03-24'].map(
    (d) => `CARD_PAYMENT,${d},Toma Café,-2.50,EUR,0.00`,
  ),

  // Gimnasio
  ...['2026-01-03', '2026-02-03', '2026-03-03'].map(
    (d) => `CARD_PAYMENT,${d},Altafit Gym,-34.90,EUR,0.00`,
  ),

  // Spotify
  ...['2026-01-14', '2026-02-14', '2026-03-14'].map(
    (d) => `CARD_PAYMENT,${d},Spotify España,-10.99,EUR,0.00`,
  ),
]

const csvBase64 = Buffer.from(csvRows.join('\n'), 'utf-8').toString('base64')

export const zaneSpain: Persona = {
  id: 'zane-spain',
  label: 'Zane — Madrid (EUR, Spanish merchants)',
  profile: {
    displayName: 'Zane',
    country: 'ES',
    city: 'Madrid',
    currency: 'EUR',
  },
  valueMapResponses: [
    { cardId: 'vm-rent', quadrant: 'foundation', confidence: 5, firstTapMs: 1100, cardTimeMs: 1600, deliberationMs: 400 },
    { cardId: 'vm-groceries', quadrant: 'foundation', confidence: 5, firstTapMs: 1000, cardTimeMs: 1500, deliberationMs: 400 },
    { cardId: 'vm-gym', quadrant: 'investment', confidence: 4, firstTapMs: 1400, cardTimeMs: 2000, deliberationMs: 500 },
    { cardId: 'vm-takeaway', quadrant: 'burden', confidence: 3, firstTapMs: 2200, cardTimeMs: 2900, deliberationMs: 700 },
    { cardId: 'vm-dinner-friends', quadrant: 'investment', confidence: 5, firstTapMs: 1100, cardTimeMs: 1600, deliberationMs: 400 },
    { cardId: 'vm-streaming', quadrant: 'burden', confidence: 3, firstTapMs: 1900, cardTimeMs: 2500, deliberationMs: 600 },
    { cardId: 'vm-learning', quadrant: 'investment', confidence: 4, firstTapMs: 1500, cardTimeMs: 2100, deliberationMs: 500 },
    { cardId: 'vm-electricity', quadrant: 'burden', confidence: 4, firstTapMs: 1300, cardTimeMs: 1900, deliberationMs: 500 },
    { cardId: 'vm-clothes', quadrant: 'leak', confidence: 3, firstTapMs: 2400, cardTimeMs: 3100, deliberationMs: 700 },
    { cardId: 'vm-gift', quadrant: 'investment', confidence: 4, firstTapMs: 1800, cardTimeMs: 2400, deliberationMs: 600 },
  ],
  csv: {
    filename: 'zane-madrid-revolut-q1-2026.csv',
    contentBase64: csvBase64,
    expectedBank: 'revolut',
  },
  expectations: {
    entryStruggle: 'dont_know',
    archetype: {
      expectedQuadrant: 'foundation',
      personalityId: 'fortress',
    },
    stagesCompleted: [
      'struggle_submitted',
      'value_map_done',
      'upload_done',
      'archetype_shown',
      'complete',
    ],
    dbAfterHandoff: {
      financial_portrait: { archetype_name: 'exists' },
      transactions: { countBetween: [55, 80] },
    },
    hardRules: {
      bannedWords: ['advise', 'advice', "The CFO's Office", 'lecture'],
      bannedPatterns: [
        // Spanish utility billing is bi/tri-monthly; assuming monthly is the
        // failure mode for the ES market.
        'monthly\\s+electricity',
        'monthly\\s+water',
        'every\\s+month\\s+(your\\s+)?(electricity|water)',
        // £ symbol on a EUR persona is a currency-handling failure.
        '£[0-9]',
      ],
      insight: {
        mustReferenceMerchantsFromCsv: ['mercadona', 'endesa', 'movistar'],
        mustReferenceOneOf: ['€', 'eur', 'every two months', 'bi-monthly', 'mercadona', 'madrid'],
        numbersMustMatchCsv: true,
      },
    },
    likertDimensions: ['warmth', 'accuracy', 'on_brand_voice', 'persona_fit', 'actionability'],
  },
}
