export type OnboardingStep =
  | 'intro_shown'
  | 'goal_chat_started'
  | 'goal_chat_tentative'
  | 'goal_set'
  | 'goal_skipped'
  // Goal + essentials (net_monthly_income, monthly_rent) all collected
  // inside the goal-chat. Routes onward to /onboarding-v2/upload — Value
  // Map is no longer a gate, it becomes an opt-in chip after the Read.
  | 'essentials_done'
  | 'value_map_started'
  | 'value_map_done'
  | 'upload_done'
  | 'archetype_shown'
  // Session 32 (B) — terminal step for users in the layered-read flow.
  // Parallel to 'archetype_shown'. The DB column is freeform text with no
  // CHECK or enum, so no migration is needed — the TS union is the only
  // place this value must be enumerated.
  | 'first_read_shown'
  | 'complete'

export type StartValueMapAction = { type: 'start_value_map' }
export type CreateActionItemAction = { id: string; title: string }

export type MessageAction = StartValueMapAction | CreateActionItemAction

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
