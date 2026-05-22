export const BRIDGE_USER_MSG_THRESHOLD = 6

/**
 * Legacy text-token action helpers. The canonical mechanism is now the
 * `emit_action` tool — see `src/lib/ai/tools/emit-action.ts`. These helpers
 * remain as defensive scrubbers for any stray <ACTION:start_value_map>
 * tokens that may show up in cached transcripts during the migration
 * window. Remove once a sweep of `messages.content` confirms no rows
 * contain the token.
 *
 * @deprecated Use emit_action via the model and read `messages.actions_created`.
 */

const ACTION_REGEX = /<ACTION:start_value_map>/gi

export function hasStartValueMapAction(text: string): boolean {
  ACTION_REGEX.lastIndex = 0
  return ACTION_REGEX.test(text)
}

export function stripActionMarkers(text: string): string {
  return text.replace(ACTION_REGEX, '').replace(/\n{3,}/g, '\n\n').trim()
}
