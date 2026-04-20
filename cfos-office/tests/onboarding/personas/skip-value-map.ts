import type { Persona } from './types'

// Minimum-engagement path. User taps Skip on Value Map and CSV upload.
// Reducer auto-skips archetype (no personalityType) and first_insight
// (no importBatchId). Result: functional-only test, no LLM output generated.

export const skipValueMap: Persona = {
  id: 'skip-value-map',
  label: 'Skip path — Value Map declined',
  profile: {
    displayName: 'Casey',
    country: 'GB',
    city: 'Edinburgh',
    currency: 'GBP',
  },
  valueMapResponses: null,
  csv: null,
  skipBeats: ['value_map', 'csv_upload'],
  expectations: {
    archetype: {
      expectedQuadrant: 'foundation',
      personalityId: 'truth_teller',
    },
    beatsCompleted: ['welcome', 'framework', 'value_map', 'csv_upload', 'capabilities', 'handoff'],
    beatsSkipped: ['archetype', 'first_insight'],
    dbAfterHandoff: {
      /* primary_currency collected post-onboarding in chat, not asserted here */
      transactions: { countBetween: [0, 0] },
    },
    likertDimensions: [],
  },
}
