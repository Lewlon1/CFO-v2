export type OnboardingStep =
  | 'intro_shown'
  | 'goal_chat_started'
  | 'goal_chat_tentative'
  | 'goal_set'
  | 'goal_skipped'
  // Legacy (pre-value-first). Goal + essentials collected in goal-chat,
  // then routes to /onboarding-v2/upload. Users stamped here continue to
  // land on upload — the data is already populated.
  | 'essentials_done'
  // Value-first flow: goal confirmed in chat; user is on the upload screen
  // but has not yet imported. Routes to /onboarding-v2/upload.
  | 'upload_pending'
  // Value-first flow: import kicked off; the processing screen is up,
  // hosting the income + rent form alongside the parse/aggregate wait.
  | 'upload_processing'
  // Value-first flow: income + rent form submitted; awaiting confirm of the
  // reconciled fixed-cost list. Routes to /onboarding-v2/confirm.
  | 'details_pending'
  // Value-first flow: confirm/reconcile of fixed costs is complete.
  // monthly_snapshots.total_fixed_costs is populated.
  | 'details_confirmed'
  | 'value_map_started'
  | 'value_map_done'
  | 'upload_done'
  // ── Estimates-first flow (OB-2). Chat-first, no-statement onboarding: the
  // user sketches their month from band taps and the completion gate moves to
  // the estimate Read. Each step is an in-sheet beat (see in-sheet-steps.ts /
  // estimate-beat-host.tsx). The DB column is freeform text, so these are
  // type-only additions — no migration. Steps run in this order:
  //   door → context → composite → goal → income → sketch → verdicts →
  //   read_pending → first_read_delivered (REUSED — stamps completion).
  | 'estimate_door'
  | 'estimate_context'
  | 'estimate_composite'
  | 'estimate_goal'
  | 'estimate_income'
  | 'estimate_sketch'
  | 'estimate_verdicts'
  // Read composing/handoff in flight; the estimate-read route delivers and
  // advances to 'first_read_delivered' (the existing completion terminal).
  | 'estimate_read_pending'
  // ── Post-completion statement-check mission (OB-3). Optional accuracy pass:
  // one month of statements verifies the estimates. Reuses the upload/confirm
  // beats; the reality-check Read leads with estimate-vs-reality deltas.
  | 'check_upload_pending'
  | 'check_processing'
  | 'check_confirm_pending'
  // Fixed costs committed against the real month (NOT details_confirmed — that
  // would trigger the legacy value-first Read). Terminal-in-flight: the host's
  // effect composes the reality-check Read and advances to reality_check_delivered.
  // Distinct step so a refresh mid-compose resumes the (idempotent) Read trigger
  // instead of re-rendering the confirm beat and double-inserting fixed costs.
  | 'check_confirm_done'
  | 'reality_check_delivered'
  | 'archetype_shown'
  // Session 32 (B) — terminal step for users in the layered-read flow.
  // Parallel to 'archetype_shown'. The DB column is freeform text with no
  // CHECK or enum, so no migration is needed — the TS union is the only
  // place this value must be enumerated.
  | 'first_read_shown'
  // Value-first flow: First Read composed and delivered. THIS stamps
  // onboarding_completed_at — the Value Map is now pure upgrade.
  | 'first_read_delivered'
  // Value-first flow: the optional Value Map invitation has been surfaced.
  // The user can accept (Layer 2 recomposition) or skip (stay complete).
  | 'value_map_offered'
  | 'complete'

/** Minimal active-goal summary threaded into the upload beat so the CFO can
 *  acknowledge the goal by name before asking for statements. */
export type OnboardingGoalSummary = {
  name: string
  targetAmount: number | null
  currency: string
}

export type StartValueMapAction = { type: 'start_value_map' }
export type StartUploadAction = { type: 'start_upload' }
export type StartValueMapRealAction = { type: 'start_value_map_real' }
/** Estimate Read close (OB-2): hands the user into the optional statement-check
 *  mission that verifies their estimates against a real month. */
export type StartStatementCheckAction = { type: 'start_statement_check' }
export type CreateActionItemAction = { id: string; title: string }

export type MessageAction =
  | StartValueMapAction
  | StartUploadAction
  | StartValueMapRealAction
  | StartStatementCheckAction
  | CreateActionItemAction

export function isStartValueMapAction(
  a: unknown,
): a is StartValueMapAction {
  return (
    typeof a === 'object' &&
    a !== null &&
    'type' in a &&
    (a as { type?: unknown }).type === 'start_value_map'
  )
}
