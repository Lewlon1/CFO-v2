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

export type StartValueMapAction = { type: 'start_value_map' }
export type StartUploadAction = { type: 'start_upload' }
export type StartValueMapRealAction = { type: 'start_value_map_real' }
export type CreateActionItemAction = { id: string; title: string }

export type MessageAction =
  | StartValueMapAction
  | StartUploadAction
  | StartValueMapRealAction
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
