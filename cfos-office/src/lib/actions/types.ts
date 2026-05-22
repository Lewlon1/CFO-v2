/**
 * Structured action vocabulary emitted by the `emit_action` tool.
 *
 * The chat route persists these to `messages.actions_created` (existing JSONB
 * column) and the frontend reads them to render inline UI. Adding a new action
 * means: (1) add to ACTION_TYPES, (2) handle the side effect in emit-action.ts
 * (optional), (3) render or route on it in MessageList / ChatProvider.
 */

export const ACTION_TYPES = [
  'start_value_map',
  'goal_set',
  'goal_skipped_now',
  'upload_statement',
  'open_folder',
] as const

export type ActionType = (typeof ACTION_TYPES)[number]

export interface EmittedAction<T extends ActionType = ActionType> {
  type: T
  metadata?: Record<string, unknown> | null
}

export function isEmittedAction(value: unknown): value is EmittedAction {
  if (typeof value !== 'object' || value === null) return false
  const t = (value as { type?: unknown }).type
  return typeof t === 'string' && (ACTION_TYPES as readonly string[]).includes(t)
}

export function findAction<T extends ActionType>(
  actions: unknown,
  type: T,
): EmittedAction<T> | null {
  if (!Array.isArray(actions)) return null
  const match = actions.find(
    (a): a is EmittedAction => isEmittedAction(a) && a.type === type,
  )
  return (match as EmittedAction<T>) ?? null
}
