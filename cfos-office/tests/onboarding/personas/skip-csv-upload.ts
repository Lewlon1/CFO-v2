import type { Persona } from './types'

// Chat-first path — debt struggle.
//
// In v1 this persona tested the modal's reducer auto-skip behaviour when
// the user uploaded no CSV. v2 has no reducer and no auto-skip; in the
// Marcus path the upload step is mandatory. Users with a clear goal
// (debt clearance here) skip Value Map and upload by virtue of picking a
// non-"dont_know" struggle, which routes them straight into chat with
// the debt-clearance opener.
//
// This persona therefore now covers: "debt struggle → straight to chat,
// no value-map, no upload, no archetype." It uses a different struggle
// than skip-value-map so the suite exercises both chat-first openers.

export const skipCsvUpload: Persona = {
  id: 'skip-csv-upload',
  label: 'Chat-first — Debt struggle',
  profile: {
    displayName: 'Morgan',
    country: 'GB',
    city: 'Cardiff',
    currency: 'GBP',
  },
  valueMapResponses: null,
  csv: null,
  expectations: {
    entryStruggle: 'debt',
    archetype: null,
    stagesCompleted: ['struggle_submitted', 'chat_opener'],
    dbAfterHandoff: {
      user_profiles: { entry_struggle: 'debt', onboarding_route: 'chat' },
      transactions: { countBetween: [0, 0] },
    },
    likertDimensions: [],
  },
}
