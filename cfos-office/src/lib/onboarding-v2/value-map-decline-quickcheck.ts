export type QuickDeclineResult = 'declined' | 'accepted' | 'ambiguous'

const DECLINE_RE =
  /\b(no thanks?|no thank you|not now|not really|nope|nah|skip( it)?|pass|maybe later|maybe another time|another time|not interested|i'?ll pass|let'?s skip|don'?t want to|rather not)\b/i

const ACCEPT_RE =
  /\b(yes|yeah|yep|sure|ok(ay)?|sounds good|let'?s do (it|that)|let'?s go|go for it|i'?m in|alright|fine|why not|sure thing|let'?s try( it)?)\b/i

export function quickClassifyDecline(text: string): QuickDeclineResult {
  const trimmed = text.trim()
  if (!trimmed) return 'ambiguous'
  const declineHit = DECLINE_RE.test(trimmed)
  const acceptHit = ACCEPT_RE.test(trimmed)
  if (declineHit && !acceptHit) return 'declined'
  if (acceptHit && !declineHit) return 'accepted'
  return 'ambiguous'
}
