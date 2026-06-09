/**
 * Structured action vocabulary emitted by the `emit_action` tool.
 *
 * The chat route persists these to `messages.actions_created` (existing JSONB
 * column) and the frontend reads them to render inline UI or trigger client-
 * side side effects. Adding a new action means: (1) add to ACTION_TYPES,
 * (2) handle the side effect in emit-action.ts (optional), (3) render or
 * route on it in MessageList / ChatProvider.
 */

export const ACTION_TYPES = [
  'start_value_map',
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
