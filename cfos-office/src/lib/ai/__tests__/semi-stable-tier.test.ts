import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Source-text regression guard for tier 2, following the same pattern as
 * no-greet-warmly.test.ts: the builders that compose this tier are private, so
 * the assertion is on the source rather than the rendered prompt.
 *
 * Tier 2 sits above the second Bedrock cache point. It is *allowed* to change
 * when the user's own data changes — that is what it is for. What it must never
 * contain is anything that changes with the CLOCK, because that invalidates the
 * tier on a rolling basis for every user, forever, at 1.25× write cost instead
 * of 0.1× read cost.
 *
 * This is not hypothetical. The memory index rendered `formatRelativeAge`
 * ("5d ago"), so tier 2 was being thrown away daily, per file, for every user
 * with a filing cabinet — while the tier split was believed to be saving money.
 * The index now renders absolute dates; this test is what stops it coming back.
 *
 * Legitimate residents of `volatile`, which is uncached by design:
 *   - buildCurrentDateContext — the date stamp itself
 *   - openItemsBlock          — renders "${days_remaining} days remaining"
 *   - profilingContext        — the next-questions queue, which a mid-turn
 *                               request_structured_input can change
 */

const SOURCE = readFileSync(resolve(__dirname, '..', 'context-builder.ts'), 'utf8')

/** Every `semiStable: joinSections([ ... ])` block in the file, body only. */
function semiStableBlocks(): string[] {
  // The closing bracket's indentation varies by branch (the nested ones sit two
  // spaces deeper), so match any leading whitespace — pinning it to four made
  // the lazy quantifier run past the nested closer and swallow the next block.
  return [...SOURCE.matchAll(/semiStable: joinSections\(\[([\s\S]*?)\n[ \t]*\]\)/g)].map(
    (match) => match[1],
  )
}

/** Comments carry the reasoning about these names; only real entries count. */
function stripComments(block: string): string {
  return block
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')
}

describe('system prompt — tier 2 carries nothing clock-derived', () => {
  it('finds every semi-stable block (guards the extraction itself)', () => {
    const blocks = semiStableBlocks()
    // goal_derive, first_read, general. If a branch is added, this number moves
    // deliberately — it must not drift because the regex silently stopped
    // matching, which would make every assertion below vacuously pass.
    expect(blocks).toHaveLength(3)
    expect(blocks.some((block) => block.includes('memoryIndex'))).toBe(true)
  })

  it.each([
    ['buildCurrentDateContext', 'the current date rolls every day'],
    ['openItemsBlock', 'renders "N days remaining"'],
    ['formatRelativeAge', 'renders "5d ago" — this is the bug that shipped'],
  ])('never references %s (%s)', (symbol) => {
    for (const block of semiStableBlocks()) {
      expect(stripComments(block)).not.toContain(symbol)
    }
  })

  it('constructs no clock of its own', () => {
    for (const block of semiStableBlocks()) {
      const body = stripComments(block)
      expect(body).not.toMatch(/new Date\s*\(/)
      expect(body).not.toMatch(/Date\.now\s*\(/)
    }
  })
})
