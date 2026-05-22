import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Source-text regression guard. Session 28 dropped the "Greet warmly"
 * instructions from the onboarding and onboarding_no_vm openers so the CFO
 * leads with the observation rather than a greeting. This test fails if a
 * future edit reintroduces the pattern in the context builder's prompt
 * source.
 *
 * Note: this asserts on the SOURCE FILE rather than the rendered prompt
 * because getConversationInstructions is private. The runtime correctness
 * check happens in scripts/compare-first-insight.ts during verification.
 */
describe('opener prompts — no greet/welcome instructions', () => {
  const source = readFileSync(
    resolve(__dirname, '..', 'context-builder.ts'),
    'utf8',
  )

  it('no "Greet ... warmly" instruction', () => {
    expect(source).not.toMatch(/Greet\s+\$\{[^}]+\}\s+warmly/)
  })

  it('no "Welcome" instruction in onboarding/first-meeting prompts', () => {
    // The literal string "Welcome" must not appear in any prompt template.
    // (It's fine if it appears in a comment or variable name; the test is
    // narrow — looks for it inside template literals only.)
    const promptStringMatches = source.match(/`[^`]*\bWelcome\b[^`]*`/g) ?? []
    expect(promptStringMatches).toEqual([])
  })

  it('v1 buildFirstInsightContext opener forbids greeting explicitly', () => {
    // Session 28 amendment: Marcus (wave-1) saw "Welcome, Marcus." because the
    // v1 first-insight context only said "Open by acknowledging the goal".
    // The opener line in buildFirstInsightContext must explicitly forbid greeting.
    expect(source).not.toMatch(/lines\.push\(\s*['"]\- Open by acknowledging the goal/)
    // And the replacement line must include the explicit ban.
    expect(source).toMatch(/Acknowledge the goal naturally/)
    expect(source).toMatch(/Do NOT greet, welcome, or address the user by name/)
  })
})
