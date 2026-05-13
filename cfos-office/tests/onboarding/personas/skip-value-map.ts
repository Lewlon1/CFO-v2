import type { Persona } from './types'

// Chat-first path — wealth struggle.
//
// In v1 this persona tested the modal's reducer auto-skip behaviour when the
// user declined the Value Map. v2 has no reducer and no auto-skip: a user who
// picks anything other than "I don't know where my money goes" goes straight
// into a chat conversation, where the CFO opens with the pre-canned
// wealth-building opener. The Value Map can be offered later via the
// chat-bridge action button, but that's a separate journey.
//
// This persona therefore now covers: "wealth struggle → straight to chat,
// no value-map, no upload, no archetype."

export const skipValueMap: Persona = {
  id: 'skip-value-map',
  label: 'Chat-first — Wealth struggle',
  profile: {
    displayName: 'Casey',
    country: 'GB',
    city: 'Edinburgh',
    currency: 'GBP',
  },
  valueMapResponses: null,
  csv: null,
  expectations: {
    entryStruggle: 'wealth',
    archetype: null,
    stagesCompleted: ['struggle_submitted', 'chat_opener'],
    dbAfterHandoff: {
      user_profiles: { entry_struggle: 'wealth', onboarding_route: 'chat' },
      transactions: { countBetween: [0, 0] },
    },
    likertDimensions: [],
  },
}
