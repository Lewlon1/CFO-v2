import { describe, it, expect, vi, afterEach } from 'vitest'
import { checkComposedRead, stripUnsupportedChips } from '../compose-first-read'
import { isReadRegenerateEnabled } from '../flags'
import type { SurplusGroundTruth } from '../insight-validator'

/**
 * The compose path's validators were log-only: a Read that cited a number the
 * server never computed, or asserted headroom its own arithmetic contradicts,
 * went to the user byte-identical. `checkComposedRead` is the predicate that now
 * decides whether that happens, so it is pinned directly.
 *
 * The `declared` branch is the sharper half of this: it ran NO validators at all
 * — it short-circuits before the main compose's checks — so the one Read
 * composed for users with no transaction history was the least verified of the
 * lot. It now shares this predicate.
 */

const TRUTH: SurplusGroundTruth = {
  freeCashFlow: 1250,
  requirements: [600],
  surplusOverRequired: 650,
  stressTestGap: 0,
  paceComputable: true,
}

const BUNDLES = [
  { toolName: 'financial_facts', output: { net_monthly_income: 3100, total_fixed_costs: 1850, free_cash_flow: 1250 } },
  { toolName: 'levers', output: [{ monthly_required_saving: 600 }] },
]

describe('checkComposedRead', () => {
  it('passes a Read whose figures all came from the server', () => {
    const verdict = checkComposedRead(
      'Your income is 3100 and fixed costs take 1850, leaving 1250 a month.',
      BUNDLES,
      TRUTH,
    )

    expect(verdict.clean).toBe(true)
    expect(verdict.citationCheck.unmatched.numbers).toEqual([])
  })

  it('catches a figure the model invented', () => {
    // 2471 was never handed to the composer. This is the class of defect that
    // used to reach the user with only a console line behind it.
    const verdict = checkComposedRead(
      'Your income is 3100, but after everything you are left with 2471 a month.',
      BUNDLES,
      TRUTH,
    )

    expect(verdict.clean).toBe(false)
    // Reported as strings — the regenerate instruction joins them into prose.
    expect(verdict.citationCheck.unmatched.numbers).toContain('2471')
  })

  it('does not treat a non-numeric citation miss as actionable', () => {
    // Pre-existing convention, preserved deliberately: the non-numeric half of
    // the citation check is noisy, and regenerating on it would fire constantly.
    const verdict = checkComposedRead('Your free cash is 1250 a month.', BUNDLES, TRUTH)

    if (!verdict.citationCheck.valid) {
      expect(verdict.citationCheck.unmatched.numbers).toEqual([])
      expect(verdict.clean).toBe(true)
    }
  })

  it('catches a conclusion the figures do not support', () => {
    // The Nova A/B failure: every number in the Read is citable, the conclusion
    // drawn from them is false. This user has 1250 free against a 600 monthly
    // requirement — they are not short, and telling them so is the highest
    // severity defect this path can produce.
    //
    // The claim needs its currency symbol: SHORTFALL_PATTERNS anchor on one, so
    // "short by 600" is not recognised as a claim at all.
    const verdict = checkComposedRead(
      'Your income is 3100 and fixed costs take 1850. You are short by £600 a month.',
      BUNDLES,
      TRUTH,
    )

    expect(verdict.reconciliation.valid).toBe(false)
    expect(verdict.clean).toBe(false)
    expect(verdict.reconciliation.violations[0].reason).toContain('no shortfall')
  })
})

describe('stripUnsupportedChips', () => {
  it('leaves a Read with no chips alone', () => {
    const message = 'A Read with no options block at all.'
    expect(stripUnsupportedChips(message)).toBe(message)
  })

  it('does not disturb chips the narrative supports', () => {
    const message = [
      'Your subscriptions come to 84 a month across six services.',
      '',
      '[OPTIONS]Subscriptions[/OPTIONS]',
    ].join('\n')

    expect(stripUnsupportedChips(message)).toContain('Subscriptions')
  })
})

describe('isReadRegenerateEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is off unless explicitly switched on', () => {
    vi.stubEnv('FIRST_READ_REGENERATE', '')
    expect(isReadRegenerateEnabled()).toBe(false)

    // Turning this on changes what users receive and costs a second Sonnet call
    // at the most expensive moment in the product. It must not default on, and
    // it must not be enabled by anything vaguer than the exact string.
    vi.stubEnv('FIRST_READ_REGENERATE', 'true')
    expect(isReadRegenerateEnabled()).toBe(false)
  })

  it('switches on for exactly "1"', () => {
    vi.stubEnv('FIRST_READ_REGENERATE', '1')
    expect(isReadRegenerateEnabled()).toBe(true)
  })
})
