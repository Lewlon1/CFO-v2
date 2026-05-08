export const BRIDGE_USER_MSG_THRESHOLD = 6

const ACTION_REGEX = /<ACTION:start_value_map>/gi

export function hasStartValueMapAction(text: string): boolean {
  ACTION_REGEX.lastIndex = 0
  return ACTION_REGEX.test(text)
}

export function stripActionMarkers(text: string): string {
  return text.replace(ACTION_REGEX, '').replace(/\n{3,}/g, '\n\n').trim()
}
