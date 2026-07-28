import { describe, it, expect } from 'vitest'
import { mapChatErrorMessage } from './chat-error-message'

describe('mapChatErrorMessage', () => {
  it('renders the server-authored message verbatim for a limit body (Rule 7: copy lives server-side)', () => {
    const body = JSON.stringify({
      error: 'limit',
      message: "We've covered a lot today — I'll pick this up with you tomorrow.",
    })
    expect(mapChatErrorMessage(body)).toBe(
      "We've covered a lot today — I'll pick this up with you tomorrow.",
    )
  })

  it('a limit body with no message falls through to the generic copy (never renders undefined)', () => {
    expect(mapChatErrorMessage(JSON.stringify({ error: 'limit' }))).toBe(
      'Something went wrong. Please try again.',
    )
  })

  it("maps the in-flight guard's busy body to the too-many-requests copy", () => {
    expect(mapChatErrorMessage(JSON.stringify({ error: 'busy' }))).toBe(
      'Too many requests. Please wait a moment and try again.',
    )
  })

  it('maps raw 429 / timeout / generic messages as before', () => {
    expect(mapChatErrorMessage('HTTP 429 from upstream')).toBe(
      'Too many requests. Please wait a moment and try again.',
    )
    expect(mapChatErrorMessage('upstream timeout while streaming')).toBe(
      'Response timed out. Please try again.',
    )
    expect(mapChatErrorMessage('Gateway 504')).toBe('Response timed out. Please try again.')
    expect(mapChatErrorMessage('kaboom')).toBe('Something went wrong. Please try again.')
    expect(mapChatErrorMessage(undefined)).toBe('Something went wrong. Please try again.')
  })
})
