export type BillType =
  | 'electricity'
  | 'gas'
  | 'water'
  | 'internet'
  | 'mobile'
  | 'insurance'
  | 'subscription'

export interface KnownProvider {
  name: string
  aliases: string[] // uppercase patterns to match against transaction descriptions
  type: BillType
  country: 'ES' | 'UK' | 'EU'
  typical_frequency: string
  comparison_market: string
  icon: string
}

export const KNOWN_PROVIDERS: KnownProvider[] = [
  // ── Spanish Electricity ───────────────────────────────────────────────
  {
    name: 'Iberdrola',
    aliases: ['IBERDROLA', 'IBERDROLA CLIENTES'],
    type: 'electricity',
    country: 'ES',
    typical_frequency: 'bimonthly',
    comparison_market: 'Spanish electricity provider tariff comparison',
    icon: '\u26A1',
  },
  {
    name: 'Endesa',
    aliases: ['ENDESA', 'ENDESA ENERGIA'],
    type: 'electricity',
    country: 'ES',
    typical_frequency: 'bimonthly',
    comparison_market: 'Spanish electricity provider tariff comparison',
    icon: '\u26A1',
  },
  {
    name: 'Naturgy',
    aliases: ['NATURGY', 'GAS NATURAL'],
    type: 'gas',
    country: 'ES',
    typical_frequency: 'bimonthly',
    comparison_market: 'Spanish gas provider tariff comparison',
    icon: '\uD83D\uDD25',
  },
  {
    name: 'Repsol Electricidad',
    aliases: ['REPSOL'],
    type: 'electricity',
    country: 'ES',
    typical_frequency: 'monthly',
    comparison_market: 'Spanish electricity provider tariff comparison',
    icon: '\u26A1',
  },
  {
    name: 'Octopus Energy Espa\u00F1a',
    aliases: ['OCTOPUS ENERGY', 'OCTOPUS'],
    type: 'electricity',
    country: 'ES',
    typical_frequency: 'monthly',
    comparison_market: 'Spanish electricity provider tariff comparison',
    icon: '\u26A1',
  },
  {
    name: 'Holaluz',
    aliases: ['HOLALUZ'],
    type: 'electricity',
    country: 'ES',
    typical_frequency: 'monthly',
    comparison_market: 'Spanish electricity provider tariff comparison',
    icon: '\u26A1',
  },

  // ── Spanish Internet / Mobile ─────────────────────────────────────────
  {
    name: 'Digi',
    aliases: ['DIGI', 'DIGI SPAIN', 'DIGI MOBIL'],
    type: 'internet',
    country: 'ES',
    typical_frequency: 'monthly',
    comparison_market: 'Spanish fibra internet mobile provider comparison',
    icon: '\uD83D\uDCF1',
  },
  {
    name: 'Movistar',
    aliases: ['MOVISTAR', 'TELEFONICA'],
    type: 'internet',
    country: 'ES',
    typical_frequency: 'monthly',
    comparison_market: 'Spanish fibra internet mobile provider comparison',
    icon: '\uD83D\uDCF1',
  },
  {
    name: 'Pepephone',
    aliases: ['PEPEPHONE'],
    type: 'internet',
    country: 'ES',
    typical_frequency: 'monthly',
    comparison_market: 'Spanish fibra internet mobile provider comparison',
    icon: '\uD83D\uDCF1',
  },
  {
    name: 'O2 Espa\u00F1a',
    aliases: ['O2', 'O2 SPAIN'],
    type: 'mobile',
    country: 'ES',
    typical_frequency: 'monthly',
    comparison_market: 'Spanish mobile provider comparison',
    icon: '\uD83D\uDCF1',
  },
  {
    name: 'Vodafone Espa\u00F1a',
    aliases: ['VODAFONE'],
    type: 'internet',
    country: 'ES',
    typical_frequency: 'monthly',
    comparison_market: 'Spanish fibra internet mobile provider comparison',
    icon: '\uD83D\uDCF1',
  },
  {
    name: 'Orange Espa\u00F1a',
    aliases: ['ORANGE'],
    type: 'internet',
    country: 'ES',
    typical_frequency: 'monthly',
    comparison_market: 'Spanish fibra internet mobile provider comparison',
    icon: '\uD83D\uDCF1',
  },
  {
    name: 'M\u00E1sM\u00F3vil',
    aliases: ['MASMOVIL', 'MAS MOVIL'],
    type: 'internet',
    country: 'ES',
    typical_frequency: 'monthly',
    comparison_market: 'Spanish fibra internet mobile provider comparison',
    icon: '\uD83D\uDCF1',
  },

  // ── Spanish Insurance ─────────────────────────────────────────────────
  {
    name: 'Sanitas',
    aliases: ['SANITAS', 'BUPA SANITAS'],
    type: 'insurance',
    country: 'ES',
    typical_frequency: 'monthly',
    comparison_market: 'Spanish private health insurance comparison',
    icon: '\uD83C\uDFE5',
  },
  {
    name: 'Adeslas',
    aliases: ['ADESLAS', 'SEGURCAIXA ADESLAS'],
    type: 'insurance',
    country: 'ES',
    typical_frequency: 'monthly',
    comparison_market: 'Spanish private health insurance comparison',
    icon: '\uD83C\uDFE5',
  },

  // ── Spanish Water ─────────────────────────────────────────────────────
  {
    name: 'Aig\u00FCes de Barcelona',
    aliases: ['AIGUES DE BARCELONA', 'AGBAR', 'SOCIEDAD GENERAL DE AGUAS'],
    type: 'water',
    country: 'ES',
    typical_frequency: 'quarterly',
    comparison_market: 'Barcelona water utility',
    icon: '\uD83D\uDCA7',
  },

  // ── UK Electricity / Gas ──────────────────────────────────────────────
  {
    name: 'Octopus Energy',
    aliases: ['OCTOPUS ENERGY'],
    type: 'electricity',
    country: 'UK',
    typical_frequency: 'monthly',
    comparison_market: 'UK energy provider comparison',
    icon: '\u26A1',
  },
  {
    name: 'British Gas',
    aliases: ['BRITISH GAS', 'BG ENERGY'],
    type: 'gas',
    country: 'UK',
    typical_frequency: 'monthly',
    comparison_market: 'UK gas provider comparison',
    icon: '\uD83D\uDD25',
  },
  {
    name: 'EDF Energy',
    aliases: ['EDF', 'EDF ENERGY'],
    type: 'electricity',
    country: 'UK',
    typical_frequency: 'monthly',
    comparison_market: 'UK energy provider comparison',
    icon: '\u26A1',
  },
  {
    name: 'SSE Energy',
    aliases: ['SSE', 'SSE ENERGY'],
    type: 'electricity',
    country: 'UK',
    typical_frequency: 'monthly',
    comparison_market: 'UK energy provider comparison',
    icon: '\u26A1',
  },

  // ── UK Internet / Mobile ──────────────────────────────────────────────
  {
    name: 'BT',
    aliases: ['BT GROUP', 'BT BROADBAND'],
    type: 'internet',
    country: 'UK',
    typical_frequency: 'monthly',
    comparison_market: 'UK broadband provider comparison',
    icon: '\uD83D\uDCF1',
  },
  {
    name: 'Sky',
    aliases: ['SKY UK', 'SKY BROADBAND'],
    type: 'internet',
    country: 'UK',
    typical_frequency: 'monthly',
    comparison_market: 'UK broadband provider comparison',
    icon: '\uD83D\uDCF1',
  },
]

/**
 * Bill type groupings for display on the bills page.
 */
export const BILL_TYPE_GROUPS: Record<string, { label: string; icon: string; types: BillType[] }> = {
  utilities: { label: 'Utilities', icon: '\u26A1', types: ['electricity', 'gas', 'water'] },
  connectivity: { label: 'Connectivity', icon: '\uD83D\uDCF1', types: ['internet', 'mobile'] },
  insurance: { label: 'Insurance', icon: '\uD83C\uDFE5', types: ['insurance'] },
  subscriptions: { label: 'Subscriptions', icon: '\uD83D\uDCFA', types: ['subscription'] },
}

/**
 * Match a transaction description or merchant name to a known provider.
 */
export function matchProvider(
  description: string,
  merchant?: string
): { provider: KnownProvider; confidence: number } | null {
  const searchText = `${description} ${merchant || ''}`.toUpperCase()

  for (const provider of KNOWN_PROVIDERS) {
    for (const alias of provider.aliases) {
      if (searchText.includes(alias)) {
        return { provider, confidence: 0.9 }
      }
    }
    if (searchText.includes(provider.name.toUpperCase())) {
      return { provider, confidence: 0.7 }
    }
  }

  return null
}

/**
 * Get the icon for a bill type.
 */
export function billTypeIcon(type: string): string {
  for (const group of Object.values(BILL_TYPE_GROUPS)) {
    if (group.types.includes(type as BillType)) return group.icon
  }
  return '\uD83D\uDCCB'
}

/**
 * Get the group key for a bill type.
 */
export function billTypeGroup(type: string): string {
  for (const [key, group] of Object.entries(BILL_TYPE_GROUPS)) {
    if (group.types.includes(type as BillType)) return key
  }
  return 'other'
}
