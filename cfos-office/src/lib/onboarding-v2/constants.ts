/**
 * Single source of truth for onboarding-v2 string constants. Two surfaces:
 *
 *   - CONVERSATION_TYPES — `conversations.type` values that the office layout,
 *     chat route, ChatProvider, and context-builder need to agree on.
 *   - STRUGGLE_OPTIONS / STRUGGLE_PROMPT_SUMMARY / STRUGGLE_LABELS — the
 *     entry-struggle question's UI labels and their prompt-side
 *     quoted-speech variants.
 */

export const CONVERSATION_TYPES = {
  ONBOARDING_GOAL_CHAT: 'onboarding_goal_chat',
  FIRST_INSIGHT: 'first_insight',
  POST_UPLOAD: 'post_upload',
  VALUE_MAP_COMPLETE: 'value_map_complete',
  MONTHLY_REVIEW: 'monthly_review',
  BILL_OPTIMISATION: 'bill_optimisation',
  NUDGE_INITIATED: 'nudge_initiated',
  ONBOARDING: 'onboarding',
  ONBOARDING_NO_VM: 'onboarding_no_vm',
  VALUE_CHECKIN_DONE: 'value_checkin_done',
  CHIP_OPENER: 'chip_opener',
} as const

export type ConversationType = (typeof CONVERSATION_TYPES)[keyof typeof CONVERSATION_TYPES]

export const STRUGGLE_OPTIONS = [
  { id: 'dont_know', label: "I don't know where my money goes" },
  { id: 'debt', label: "I'm carrying debt I want to clear" },
  { id: 'wealth', label: 'I want to start building wealth' },
  { id: 'planning', label: "I'm planning for something specific" },
] as const

export type StruggleOptionId = (typeof STRUGGLE_OPTIONS)[number]['id']
export type EntryStruggle = StruggleOptionId | 'free_text'

/**
 * UI label map. Computed from STRUGGLE_OPTIONS so the two can never drift.
 */
export const STRUGGLE_LABELS: Record<EntryStruggle, string> = {
  ...(Object.fromEntries(STRUGGLE_OPTIONS.map((o) => [o.id, o.label])) as Record<
    StruggleOptionId,
    string
  >),
  free_text: '(In their own words — see entry_struggle_text)',
}

/**
 * Prompt-side quoted-speech variants. Used by buildGoalDeriveConfirmContext.
 * Each entry returns the quoted line as it should appear in the system prompt.
 */
export const STRUGGLE_PROMPT_SUMMARY: Record<EntryStruggle, (text?: string | null) => string> = {
  dont_know: () => 'The user said: "I don\'t know where my money goes."',
  debt: () => 'The user said: "I\'m carrying debt I want to clear."',
  wealth: () => 'The user said: "I want to start building wealth."',
  planning: () => 'The user said: "I\'m planning for something specific."',
  free_text: (text) =>
    text && text.trim().length > 0
      ? `The user said, in their own words: "${text}"`
      : 'The user has not yet articulated a struggle.',
}
