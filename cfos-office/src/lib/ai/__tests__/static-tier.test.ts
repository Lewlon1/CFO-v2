import { describe, it, expect } from 'vitest'
import { buildStaticTier, type StaticTierVariant } from '../context-builder'

/**
 * Tier 1 of the system prompt sits above the first Bedrock cache point, so its
 * only real contract is that it does not change between turns. A date, a count,
 * or any other user- or clock-derived byte slipping in costs the whole prefix —
 * silently, and on every turn, which is exactly the failure the tier split
 * exists to end.
 *
 * The three registers are the only legitimate variation: `advice_style` has
 * three values, so there are three possible tier-1 strings per branch and a
 * user's own prefix is stable for as long as they keep their register.
 */
const REGISTERS = [
  '\n\nRegister: direct. Short declarative sentences.',
  '\n\nRegister: blunt. Strip qualifiers.',
  '\n\nRegister: gentle. Warmer phrasing around the same finding.',
]

const VARIANTS: StaticTierVariant[] = ['general', 'first_read', 'goal_derive']

describe('buildStaticTier', () => {
  it('is byte-identical across calls for every branch and register', () => {
    for (const variant of VARIANTS) {
      for (const register of REGISTERS) {
        expect(buildStaticTier(register, variant)).toBe(buildStaticTier(register, variant))
      }
    }
  })

  it('carries no clock-derived content', () => {
    const now = new Date()
    const thisYear = String(now.getUTCFullYear())
    const isoToday = now.toISOString().slice(0, 10)

    for (const variant of VARIANTS) {
      const tier = buildStaticTier(REGISTERS[0], variant)
      expect(tier).not.toContain(isoToday)
      // The persona's examples are dateless; a bare current year here would mean
      // something time-derived has been folded into the cached prefix.
      expect(tier).not.toContain(thisYear)
    }
  })

  it('gives each register its own prefix, and only the register differs', () => {
    const [direct, blunt] = REGISTERS
    expect(buildStaticTier(direct, 'general')).not.toBe(buildStaticTier(blunt, 'general'))
    expect(buildStaticTier(direct, 'general').replace(direct, blunt)).toBe(
      buildStaticTier(blunt, 'general'),
    )
  })

  it('carries the advisory perimeter on every branch that can discuss money', () => {
    // The perimeter was absent for asset-less users before Phase 3 moved it out
    // of the balance-sheet builder. Pin it here so a tier reshuffle can't drop it.
    expect(buildStaticTier(REGISTERS[0], 'general')).toContain('## Advisory boundaries')
    expect(buildStaticTier(REGISTERS[0], 'first_read')).toContain('## Advisory boundaries')
  })

  it('gives the goal beat the lean tier, and the general branch the full one', () => {
    const goalDerive = buildStaticTier(REGISTERS[0], 'goal_derive')
    const firstRead = buildStaticTier(REGISTERS[0], 'first_read')
    const general = buildStaticTier(REGISTERS[0], 'general')

    // The goal beat predates any financial surface: no cabinet, no perimeter.
    expect(goalDerive).not.toContain('## Your files on this user')
    expect(goalDerive.length).toBeLessThan(firstRead.length)

    // The behavioural-feature tools are the general conversation's move only.
    expect(general).toContain('## Behavioural features and prior conversation')
    expect(firstRead).not.toContain('## Behavioural features and prior conversation')

    // The cabinet contract ships on both of the branches that can use it.
    expect(firstRead).toContain('## Your files on this user')
    expect(general).toContain('## Your files on this user')
  })
})
