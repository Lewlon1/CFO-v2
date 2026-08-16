import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
  // The cabinet is on by default, but an A/B arm can leave MEMORY_FILES_ENABLED=0
  // in the shell. These assertions are about the shipped prompt, so pin the flag
  // on rather than letting the ambient environment decide what they mean.
  beforeEach(() => {
    vi.stubEnv('MEMORY_FILES_ENABLED', '1')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

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

/**
 * MEMORY_FILES_ENABLED=0 is the control arm for measuring whether the filing
 * cabinet earns its tokens. It has to remove the whole feature — contract and
 * tool descriptions together — while leaving everything that is not the cabinet
 * exactly where it was.
 */
describe('buildStaticTier with the filing cabinet disabled', () => {
  beforeEach(() => {
    vi.stubEnv('MEMORY_FILES_ENABLED', '0')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('drops the contract and the tool descriptions together', () => {
    for (const variant of ['general', 'first_read'] as StaticTierVariant[]) {
      const tier = buildStaticTier(REGISTERS[0], variant)
      expect(tier).not.toContain('## Your files on this user')
      // A described-but-absent tool is worse than one never offered.
      for (const tool of ['read_memory_file', 'write_memory_file', 'archive_memory_file']) {
        expect(tier).not.toContain(tool)
      }
    }
  })

  it('keeps the advisory perimeter — the control arm is not a compliance hole', () => {
    // The perimeter went missing once already by riding inside a builder that
    // returned early. It must not depend on an unrelated feature flag.
    expect(buildStaticTier(REGISTERS[0], 'general')).toContain('## Advisory boundaries')
    expect(buildStaticTier(REGISTERS[0], 'first_read')).toContain('## Advisory boundaries')
  })

  it('is still byte-stable within the arm', () => {
    // Both arms have to be cacheable, or the comparison measures cache misses
    // rather than the cabinet.
    for (const variant of VARIANTS) {
      expect(buildStaticTier(REGISTERS[0], variant)).toBe(buildStaticTier(REGISTERS[0], variant))
    }
  })

  it('is smaller than the enabled arm on every branch', () => {
    for (const variant of VARIANTS) {
      const off = buildStaticTier(REGISTERS[0], variant).length
      vi.stubEnv('MEMORY_FILES_ENABLED', '1')
      const on = buildStaticTier(REGISTERS[0], variant).length
      vi.stubEnv('MEMORY_FILES_ENABLED', '0')
      expect(off).toBeLessThan(on)
    }
  })
})
