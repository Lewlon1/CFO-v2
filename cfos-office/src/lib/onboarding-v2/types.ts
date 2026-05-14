export type OnboardingStep =
  | 'intro_shown'
  | 'goal_chat_started'
  | 'goal_set'
  | 'goal_skipped'
  | 'value_map_started'
  | 'value_map_done'
  | 'upload_done'
  | 'archetype_shown'
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
