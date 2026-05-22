// OnboardingStep is now owned by state-machine.ts. Re-exported here for
// back-compat with existing imports.
export type { OnboardingStep } from './state-machine'

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
