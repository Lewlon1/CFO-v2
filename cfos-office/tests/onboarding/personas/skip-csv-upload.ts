import type { Persona } from './types'
import { builderClassic } from './builder-classic'

// Completes Value Map (Builder archetype) but skips CSV upload.
// Reducer auto-skips first_insight (no importBatchId).

export const skipCsvUpload: Persona = {
  id: 'skip-csv-upload',
  label: 'Skip path — CSV upload declined',
  profile: {
    displayName: 'Morgan',
    country: 'GB',
    city: 'Cardiff',
    currency: 'GBP',
  },
  valueMapResponses: builderClassic.valueMapResponses,
  csv: null,
  skipBeats: ['csv_upload'],
  expectations: {
    archetype: {
      expectedQuadrant: 'investment',
      personalityId: 'builder',
    },
    beatsCompleted: ['welcome', 'framework', 'value_map', 'archetype', 'csv_upload', 'capabilities', 'handoff'],
    beatsSkipped: ['first_insight'],
    dbAfterHandoff: {
      user_profiles: { primary_currency: 'GBP' },
      financial_portrait: { archetype_name: 'exists' },
      transactions: { countBetween: [0, 0] },
    },
    hardRules: {
      bannedWords: ['advise', 'advice', "The CFO's Office", 'lecture'],
      archetype: {
        mustReferenceQuadrant: 'investment',
        mustMentionOneOf: ['invest', 'grow', 'build', 'intentional'],
      },
    },
    likertDimensions: ['warmth', 'accuracy', 'on_brand_voice', 'persona_fit'],
  },
}
