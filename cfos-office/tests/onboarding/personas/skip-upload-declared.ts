import type { Persona } from './types'

// Skip-upload persona: exercises the "I don't have a statement handy" path
// introduced in the upload-intro beat. No CSV is uploaded; the declared Read
// composes from income + fixed costs + goal data only (no transactions).
//
// Expectations reflect the declared outcome:
//   - No transactions (the assertion in db-assertions.ts is conditional on
//     `expected.transactions?.countBetween` being set, so omitting it here
//     means zero-transaction runs are not an assertion failure).
//   - Goals count: 1 (seeded via fastForwardGoalBeat before the upload beat).
//   - onboarding_completed_at stamped once first_read is delivered.
//
// The goals assertion in assertDbState is always active: "persona with goal
// expects ≥1 row; persona without expects 0". We set a goal so the declared
// Read includes goal-pace content, and the assertion correctly passes.

export const skipUploadDeclared: Persona = {
  id: 'skip-upload-declared',
  label: 'Skip Upload — Declared Read (no statement)',
  profile: {
    displayName: 'Jamie',
    country: 'GB',
    city: 'Manchester',
    currency: 'GBP',
    // Income + rent drive the declared Read's free-cash figure and light the
    // Income + Fixed costs meter chips on the progress meter.
    monthlyIncome: 2800,
    monthlyRent: 900,
  },
  // No Value Map responses — the skip path never reaches the Value Map.
  valueMapResponses: null,
  // null csv → driver takes the "I don't have a statement handy" branch.
  csv: null,
  expectations: {
    entryStruggle: 'planning',
    archetype: null, // Skip path never produces an archetype reading.
    stagesCompleted: [
      'struggle_submitted',
      'goal_done',
      'upload_done',    // "upload_done" is reached via the skip button, not a file
      'essentials_done',
      'confirm_done',
      'first_read',
    ],
    goal: {
      name: 'House deposit',
      type: 'savings',
      targetAmount: 40000,
      currentAmount: 5000,
      targetDate: '2028-03-01',
    },
    dbAfterHandoff: {
      user_profiles: {
        onboarding_step: 'first_read_delivered',
        onboarding_completed_at: 'not-null',
      },
      // No transactions assertion — the skip persona has zero imported
      // transactions. Omitting `transactions` means assertDbState skips the
      // countBetween check (it is guarded by `if (expected.transactions?.countBetween)`).
    },
    hardRules: {
      bannedWords: ['advise', 'advice', "The CFO's Office", 'lecture'],
      insight: {
        // The declared Read leads with free cash flow and goal pace; at least
        // one of these must appear in the first Read message.
        mustReferenceOneOf: ['free cash', 'savings', 'deposit', 'goal', 'income', 'fixed costs'],
      },
    },
    likertDimensions: ['warmth', 'accuracy', 'on_brand_voice', 'actionability'],
  },
}
