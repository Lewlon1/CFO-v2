export type QuickDeferralResult = 'deferred' | 'ambiguous'

// High-precision phrases that mean "I don't want to set a goal right now — I
// just want to see what's going on first." Used by the goal-chat route to
// advance a user to the tentative hand-off immediately, instead of waiting for
// the 5-turn stall safety net. Kept deliberately narrow: a false positive only
// routes the user to the upload screen a turn early (the next step regardless),
// while a miss simply falls back to the existing stall path.
const DEFERRAL_RE =
  /\b(visibility|just (want(ing)? )?(to )?(get |gain |have )?(some )?(visibility|to see|to understand)|see where (my|the) money (go(es|ing)?|is going)|where (my|the) money (go(es|ing)?|is going)|no (specific |particular |real |set )?(goal|target|plan)|(don'?t|do not|haven'?t|not) (have|got|set|thought of) (a |any )?(goal|target)|(skip|skipping|without|no need for) (the |a |setting a )?goal|no goal( for now| yet| right now)?|not (got|have) (a|any) (goal|target))\b/i

export function quickClassifyGoalDeferral(text: string): QuickDeferralResult {
  const trimmed = text.trim()
  if (!trimmed) return 'ambiguous'
  return DEFERRAL_RE.test(trimmed) ? 'deferred' : 'ambiguous'
}
