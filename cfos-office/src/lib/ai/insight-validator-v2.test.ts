// cfos-office/src/lib/ai/insight-validator-v2.test.ts
//
// Tests for the v2 (Session v2.2 Chat Intelligence) validators added in
// Phase 6. The v1 validateNarrative tests remain in
// insight-validator.test.ts — this file covers only the v2 additions.

import { describe, it, expect } from 'vitest';
import {
  buildCitationAllowlist,
  validateCitations,
  validateProjections,
  validateVoice,
  validateChips,
  appendCorrection,
  extractCitedFigures,
  extractSurplusClaims,
  validateSurplusClaims,
  MAX_CITED_FIGURES,
  type ToolResultLike,
} from './insight-validator';

describe('buildCitationAllowlist', () => {
  it('collects numbers ≥10 from a flat tool output', () => {
    const toolResults: ToolResultLike[] = [
      {
        toolName: 'get_spending_summary',
        output: { total: 1200, average: 40 },
      },
    ];
    const allowlist = buildCitationAllowlist(toolResults, {});
    expect(allowlist.numbers.has(1200)).toBe(true);
    expect(allowlist.numbers.has(40)).toBe(true);
  });

  it('ignores numbers below 10', () => {
    const toolResults: ToolResultLike[] = [
      { toolName: 'tool_a', output: { small: 5, big: 100 } },
    ];
    const allowlist = buildCitationAllowlist(toolResults, {});
    expect(allowlist.numbers.has(5)).toBe(false);
    expect(allowlist.numbers.has(100)).toBe(true);
  });

  it('recursively walks nested objects and arrays', () => {
    const toolResults: ToolResultLike[] = [
      {
        toolName: 'find_money_clusters',
        output: {
          stories: [
            {
              magnitude: { amount: 482, share_pct: 45 },
              sample_transactions: [
                { amount: 12.5, merchant: 'Glovo' },
                { amount: 18, merchant: 'Glovo' },
              ],
            },
          ],
        },
      },
    ];
    const allowlist = buildCitationAllowlist(toolResults, {});
    expect(allowlist.numbers.has(482)).toBe(true);
    expect(allowlist.numbers.has(45)).toBe(true);
    expect(allowlist.numbers.has(12.5)).toBe(true);
    expect(allowlist.numbers.has(18)).toBe(true);
  });

  it('collects merchant names from merchant-shaped keys', () => {
    const toolResults: ToolResultLike[] = [
      {
        toolName: 'find_money_clusters',
        output: {
          stories: [
            {
              merchants: ['Glovo', 'Deliveroo'],
              sample_transactions: [
                { merchant: 'Tesco', amount: 30 },
              ],
            },
          ],
        },
      },
    ];
    const allowlist = buildCitationAllowlist(toolResults, {});
    expect(allowlist.merchants.has('glovo')).toBe(true);
    expect(allowlist.merchants.has('deliveroo')).toBe(true);
    expect(allowlist.merchants.has('tesco')).toBe(true);
  });

  it('handles top_merchants and driving_merchants keys', () => {
    const toolResults: ToolResultLike[] = [
      {
        toolName: 'whatever',
        output: {
          top_merchants: ['Vanguard'],
          driving_merchants: ['Netflix'],
        },
      },
    ];
    const allowlist = buildCitationAllowlist(toolResults, {});
    expect(allowlist.merchants.has('vanguard')).toBe(true);
    expect(allowlist.merchants.has('netflix')).toBe(true);
  });

  it('adds brief income and rent if ≥10', () => {
    const allowlist = buildCitationAllowlist([], {
      income: 2800,
      rent: 950,
    });
    expect(allowlist.numbers.has(2800)).toBe(true);
    expect(allowlist.numbers.has(950)).toBe(true);
  });

  it('skips brief values below 10 or null', () => {
    const allowlist = buildCitationAllowlist([], {
      income: 5,
      rent: null,
    });
    expect(allowlist.numbers.has(5)).toBe(false);
  });

  it('survives cyclic references in tool output', () => {
    // Synthetic — production tool output shouldn't cycle, but make sure we
    // don't blow the stack if it ever does.
    const cyclic: Record<string, unknown> = { a: 100 };
    cyclic.self = cyclic;
    const toolResults: ToolResultLike[] = [
      { toolName: 'pathological', output: cyclic },
    ];
    const allowlist = buildCitationAllowlist(toolResults, {});
    expect(allowlist.numbers.has(100)).toBe(true);
  });
});

describe('validateCitations', () => {
  it('passes when narrative only cites grounded numbers', () => {
    const allowlist = buildCitationAllowlist(
      [{ toolName: 'x', output: { amount: 482 } }],
      { income: 2800 },
    );
    const narrative = 'You spent £482 last month and your net is £2,800.';
    expect(validateCitations(narrative, allowlist).valid).toBe(true);
  });

  it('fails when narrative contains a hallucinated number', () => {
    const allowlist = buildCitationAllowlist(
      [{ toolName: 'x', output: { amount: 482 } }],
      {},
    );
    const result = validateCitations(
      'You saved £550 this month.',
      allowlist,
    );
    expect(result.valid).toBe(false);
    expect(result.unmatched.numbers).toContain('550');
  });

  it('tolerates ±1 rounding', () => {
    const allowlist = buildCitationAllowlist(
      [{ toolName: 'x', output: { amount: 30 } }],
      {},
    );
    // 29.99 is within ±1 of 30 → passes.
    expect(validateCitations('Gym is £29.99 a month.', allowlist).valid).toBe(true);
    // 31 is exactly ±1 of 30 → passes.
    expect(validateCitations('Around 31 a month.', allowlist).valid).toBe(true);
    // 32 is 2 away → fails.
    expect(validateCitations('Around 32 a month.', allowlist).valid).toBe(false);
  });

  it('returns empty unmatched arrays when valid', () => {
    const allowlist = buildCitationAllowlist(
      [{ toolName: 'x', output: { amount: 100 } }],
      {},
    );
    const result = validateCitations('A clean £100 figure.', allowlist);
    expect(result.unmatched.numbers).toEqual([]);
  });
});

describe('validateProjections', () => {
  it('passes when /year number matches annualised_impact', () => {
    const experimentResults = [
      {
        monthly_impact: { amount: 40 },
        annualised_impact: { amount: 480 },
      },
    ];
    const narrative = 'Cutting that out saves you £480/year.';
    expect(validateProjections(narrative, experimentResults).valid).toBe(true);
  });

  it('passes when /month number matches monthly_impact', () => {
    const experimentResults = [
      {
        monthly_impact: { amount: 40 },
        annualised_impact: { amount: 480 },
      },
    ];
    const narrative = '£40/month back in your pocket.';
    expect(validateProjections(narrative, experimentResults).valid).toBe(true);
  });

  it('fails on "€500/year saved" with no computed impact band to ground it', () => {
    const narrative = "If you cut subscriptions you'd save €500/year.";
    const result = validateProjections(narrative, []);
    expect(result.valid).toBe(false);
    expect(result.unmatched_projections.length).toBeGreaterThan(0);
    expect(result.unmatched_projections[0]).toMatch(/500/);
  });

  it('allows projection-shaped sentences without numbers', () => {
    const narrative = 'Monthly habits matter more than one-off moves.';
    expect(validateProjections(narrative, []).valid).toBe(true);
  });

  it('tolerates ±5 around the allowed amount', () => {
    const experimentResults = [
      { monthly_impact: { amount: 40 }, annualised_impact: { amount: 480 } },
    ];
    // 483 is within ±5 of 480.
    expect(
      validateProjections('Saves about £483/year.', experimentResults).valid,
    ).toBe(true);
    // 490 is outside ±5.
    expect(
      validateProjections('Saves about £490/year.', experimentResults).valid,
    ).toBe(false);
  });

  it('flags the full offending sentence', () => {
    const result = validateProjections(
      'That would save £999/year on its own.',
      [],
    );
    expect(result.unmatched_projections[0]).toMatch(/£999\/year/);
  });

  it('only checks projection-shaped sentences', () => {
    // Sentence has a number but no projection keyword → not checked.
    const result = validateProjections(
      'Your spend total is £482 across the period.',
      [],
    );
    expect(result.valid).toBe(true);
  });
});

describe('validateVoice', () => {
  it('catches "worth holding in mind"', () => {
    const r = validateVoice('Just worth holding in mind for next time.');
    expect(r.valid).toBe(false);
    expect(r.violations).toContain('worth holding in mind');
  });

  it('catches "worth knowing"', () => {
    const r = validateVoice('Worth knowing as you plan ahead.');
    expect(r.valid).toBe(false);
    expect(r.violations.some((v) => /worth knowing/i.test(v))).toBe(true);
  });

  it('catches "no judgement" with optional e', () => {
    const r1 = validateVoice('No judgement here.');
    const r2 = validateVoice('No judgment here.');
    expect(r1.valid).toBe(false);
    expect(r2.valid).toBe(false);
  });

  it('catches "I noticed"', () => {
    const r = validateVoice('I noticed you spent more on Glovo.');
    expect(r.valid).toBe(false);
    expect(r.violations.some((v) => /I noticed/i.test(v))).toBe(true);
  });

  it('catches "great question"', () => {
    const r = validateVoice('Great question — here\'s the breakdown.');
    expect(r.valid).toBe(false);
  });

  it('catches "advise" and "advice"', () => {
    expect(validateVoice('My advice would be to cut subs.').valid).toBe(false);
    expect(validateVoice("I'd advise pausing that.").valid).toBe(false);
  });

  it('catches "I learned"', () => {
    const r = validateVoice('I learned this approach works well.');
    expect(r.valid).toBe(false);
  });

  it('passes clean voice', () => {
    const r = validateVoice('Your top category last month was groceries at £420.');
    expect(r.valid).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('case-insensitive matching', () => {
    expect(validateVoice('WORTH HOLDING IN MIND, friend.').valid).toBe(false);
    expect(validateVoice('Great Question!').valid).toBe(false);
  });
});

describe('validateChips', () => {
  const narrative =
    'Your Glovo spend hit £482 in May. That is 45% of your eating-out category. Cutting it back to once a week would free up about £40/month.';

  it('accepts a chip that mentions a merchant from the narrative', () => {
    const r = validateChips(['Drill into Glovo'], narrative);
    expect(r.valid).toBe(true);
    expect(r.reasons['Drill into Glovo']).toBeUndefined();
  });

  it('rejects a chip with no narrative noun overlap', () => {
    const r = validateChips(['Tell me about pensions'], narrative);
    expect(r.valid).toBe(false);
    expect(r.reasons['Tell me about pensions']).toBe('no_narrative_noun');
  });

  it('rejects "Tell me more" as generic', () => {
    const r = validateChips(['Tell me more'], narrative);
    expect(r.valid).toBe(false);
    expect(r.reasons['Tell me more']).toBe('generic');
  });

  it('rejects "Let me know" as generic', () => {
    const r = validateChips(['Let me know'], narrative);
    expect(r.valid).toBe(false);
    expect(r.reasons['Let me know']).toBe('generic');
  });

  it('rejects "Show me everything" as generic', () => {
    const r = validateChips(['Show me everything'], narrative);
    expect(r.valid).toBe(false);
    expect(r.reasons['Show me everything']).toBe('generic');
  });

  it('rejects "Go to the gap" as navigation', () => {
    const r = validateChips(['Go to the gap'], narrative);
    expect(r.valid).toBe(false);
    expect(r.reasons['Go to the gap']).toBe('navigation');
  });

  it('rejects "Open the dashboard" as navigation', () => {
    const r = validateChips(['Open the dashboard'], narrative);
    expect(r.valid).toBe(false);
    expect(r.reasons['Open the dashboard']).toBe('navigation');
  });

  it('rejects "Navigate to the values folder" as navigation', () => {
    const r = validateChips(['Navigate to the values folder'], narrative);
    expect(r.valid).toBe(false);
    expect(r.reasons['Navigate to the values folder']).toBe('navigation');
  });

  it('accepts a chip referencing a number from the narrative', () => {
    // 482 is in the narrative.
    const r = validateChips(['What drove the £482?'], narrative);
    expect(r.valid).toBe(true);
  });

  it('returns mixed valid + invalid in one call', () => {
    const r = validateChips(
      ['Drill into Glovo', 'Tell me more', 'Set a goal for pensions'],
      narrative,
    );
    expect(r.valid).toBe(false);
    expect(r.reasons['Tell me more']).toBe('generic');
    expect(r.reasons['Drill into Glovo']).toBeUndefined();
    // pensions isn't in narrative → no_narrative_noun
    expect(r.reasons['Set a goal for pensions']).toBe('no_narrative_noun');
  });
});

describe('appendCorrection', () => {
  it('returns text unchanged when no issues', () => {
    const text = 'A clean message.';
    expect(appendCorrection(text, {})).toBe(text);
  });

  it('appends a single-issue note for citation numbers', () => {
    const text = 'You saved £550 this month.';
    const out = appendCorrection(text, {
      unmatched_citations: { numbers: ['550'], merchants: [] },
    });
    expect(out).toContain('System note');
    expect(out).toContain('1 issue');
    expect(out).toContain('1 number not grounded');
  });

  it('summarises multiple issue types', () => {
    const out = appendCorrection('Body.', {
      unmatched_citations: { numbers: ['100', '200'], merchants: [] },
      unmatched_projections: ['£500/year saved.'],
      voice_violations: ['I noticed'],
    });
    expect(out).toContain('3 issues');
    expect(out).toContain('2 numbers not grounded');
    expect(out).toContain('1 projection not backed');
    expect(out).toContain('1 voice phrase');
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// extractCitedFigures (Session 083)
//
// The inverse of validateCitations. Feeds read_feedback.citation_set, so a beta
// user's "that number is wrong" traces back to the bundle that computed it.
// ─────────────────────────────────────────────────────────────────────────────

describe('extractCitedFigures', () => {
  const bundles: ToolResultLike[] = [
    { toolName: 'financial_facts', output: { income: 3300, rent: 1200 } },
    { toolName: 'levers', output: [{ monthly_impact: 85 }] },
    { toolName: 'spending_breakdown', output: { top_categories: [{ name: 'dining', total: 420 }] } },
  ];

  it('returns only figures the prose actually cited, each tagged with its bundle', () => {
    const figures = extractCitedFigures('Dining ran £420 against income of £3,300.', bundles);
    // Narrative order, not bundle order — the list reads in the same sequence
    // the user met the figures, which is the order they will describe them in.
    expect(figures).toEqual([
      { value: 420, source: 'spending_breakdown' },
      { value: 3300, source: 'financial_facts' },
    ]);
  });

  it('omits allowlist figures the prose never mentioned', () => {
    const figures = extractCitedFigures('Dining ran £420.', bundles);
    expect(figures.map((f) => f.value)).toEqual([420]);
    expect(figures.map((f) => f.value)).not.toContain(1200);
  });

  it('omits prose numbers that trace to nothing — those are validateCitations business', () => {
    const figures = extractCitedFigures('You spent £999 on dining.', bundles);
    expect(figures).toEqual([]);
  });

  it('honours the same ±1 tolerance validateCitations uses, so the two agree', () => {
    const figures = extractCitedFigures('Rent is about £1,201.', bundles);
    expect(figures).toEqual([{ value: 1201, source: 'financial_facts' }]);
  });

  it('ignores numbers under 10, matching extractNumbers', () => {
    const figures = extractCitedFigures('Three meals, £420 total.', [
      { toolName: 'spending_breakdown', output: { count: 3, total: 420 } },
    ]);
    expect(figures).toEqual([{ value: 420, source: 'spending_breakdown' }]);
  });

  it('attributes a figure to the first bundle that contains it, deterministically', () => {
    const shared: ToolResultLike[] = [
      { toolName: 'financial_facts', output: { rent: 1200 } },
      { toolName: 'spending_breakdown', output: { housing: 1200 } },
    ];
    expect(extractCitedFigures('Rent £1,200.', shared)).toEqual([
      { value: 1200, source: 'financial_facts' },
    ]);
  });

  it('does not lose a later bundle to a shared object reference', () => {
    // buildCitationAllowlist shares one visited WeakSet across bundles, which is
    // harmless for a union but would silently blank the second source here.
    const shared = { total: 420 };
    const figures = extractCitedFigures('Dining £420.', [
      { toolName: 'financial_facts', output: { nested: shared } },
      { toolName: 'spending_breakdown', output: { nested: shared } },
    ]);
    expect(figures).toEqual([{ value: 420, source: 'financial_facts' }]);
  });

  it('dedupes a figure repeated in the prose', () => {
    const figures = extractCitedFigures('£420 on dining. That £420 is the story.', bundles);
    expect(figures).toEqual([{ value: 420, source: 'spending_breakdown' }]);
  });

  it('caps the result so conversation metadata stays small', () => {
    const many = Array.from({ length: MAX_CITED_FIGURES + 15 }, (_, i) => 100 + i);
    const figures = extractCitedFigures(many.join(', '), [
      { toolName: 'spending_breakdown', output: many },
    ]);
    expect(figures).toHaveLength(MAX_CITED_FIGURES);
  });

  it('returns an empty array for an empty bundle list', () => {
    expect(extractCitedFigures('Dining ran £420.', [])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateSurplusClaims (Session 083)
//
// The regression corpus is real: every string in the "Nova A/B regressions"
// block below is copied verbatim from tests/onboarding/test-output/
// nova-vs-claude-nova-full, and every string in the "stays quiet on correct
// Reads" block from the Claude run of the same persona on the same data. If a
// future change makes the first block pass or the second block fail, the check
// has stopped doing its job.
// ─────────────────────────────────────────────────────────────────────────────

describe('extractSurplusClaims', () => {
  it('finds a shortfall phrased as "you\'re £62 short"', () => {
    expect(extractSurplusClaims("The exposure is at the low-return end, where you're £62 short.")).toEqual([
      { kind: 'shortfall', value: 62, phrase: '£62 short' },
    ])
  })

  it('finds "short by" and "gap" phrasings', () => {
    expect(extractSurplusClaims('short by £300').map((c) => c.value)).toEqual([300])
    expect(extractSurplusClaims('cover that £463 gap').map((c) => c.value)).toEqual([463])
  })

  it('finds surplus phrasings, including per-month suffixes', () => {
    expect(extractSurplusClaims('covers £1,187 with £283 to spare')[0]).toEqual({
      kind: 'surplus', value: 283, phrase: '£283 to spare',
    })
    expect(extractSurplusClaims('£1,470 clears £1,249 with £221 left').map((c) => c.value)).toEqual([221])
    expect(extractSurplusClaims('with £1,099/mo to spare').map((c) => c.value)).toEqual([1099])
  })

  it('handles thousands separators and euro amounts', () => {
    expect(extractSurplusClaims('you are €1,250 short').map((c) => c.value)).toEqual([1250])
  })

  it('is re-runnable — module-level /g regexes reset between calls', () => {
    const text = "you're £62 short"
    expect(extractSurplusClaims(text)).toEqual(extractSurplusClaims(text))
  })

  it('returns nothing for prose with no headroom claim', () => {
    expect(extractSurplusClaims('Dining ran £420 this month, £110 above your average.')).toEqual([])
  })
})

describe('validateSurplusClaims — Nova A/B regressions (must all be caught)', () => {
  // Ground truth as it ACTUALLY is in these runs: no accelerate lever (it is
  // absent whenever monthly_required_saving is null or the facts reconciliation
  // drops it), so the requirement band + free cash flow is the only truth there
  // is. A first cut of this check keyed on the lever alone and silently skipped
  // all four of these Reads — hence the shape of these fixtures.
  const builderClassic = {
    freeCashFlow: 1470, requirements: [1249, 1187, 1126],
    surplusOverRequired: null, stressTestGap: null, paceComputable: true,
  }

  it('builder-classic: £62 shortfall invented from need(4%) − need(7%)', () => {
    const r = validateSurplusClaims(
      "At the 7% plan, your free cash flow already covers the £1,187 needed, with £283 to spare. " +
        "The exposure is at the low-return end, where you're £62 short.",
      builderClassic,
    )
    expect(r.valid).toBe(false)
    expect(r.skipped).toBe(false)
    expect(r.violations.map((v) => v.claim.value)).toEqual([62])
    expect(r.violations[0].reason).toContain('there is no shortfall')
  })

  it('time-saver-expert: £33 shortfall against £1,066 of real headroom', () => {
    const r = validateSurplusClaims(
      "£3,798 covers £2,699 with £1,100 to spare. The exposure is at the low-return end, where you're £33 short.",
      { freeCashFlow: 3798, requirements: [2732, 2699, 2667],
        surplusOverRequired: null, stressTestGap: null, paceComputable: true },
    )
    expect(r.valid).toBe(false)
    expect(r.violations.map((v) => v.claim.value)).toEqual([33])
  })

  it('time-saver-expert rerun: the phantom "£901 gap"', () => {
    const r = validateSurplusClaims(
      'the single category big enough to cover the £901 gap on its own',
      { freeCashFlow: 3798, requirements: [2732, 2699, 2667],
        surplusOverRequired: null, stressTestGap: null, paceComputable: true },
    )
    expect(r.valid).toBe(false)
    expect(r.violations.map((v) => v.claim.value)).toEqual([901])
  })

  it('zane-spain: €300 shortfall against a €20 surplus', () => {
    const r = validateSurplusClaims(
      "€820 covers €500 with €320 to spare. The exposure is at the low-return end, where you're €300 short.",
      { freeCashFlow: 820, requirements: [800, 500],
        surplusOverRequired: null, stressTestGap: null, paceComputable: true },
    )
    expect(r.valid).toBe(false)
    expect(r.violations.map((v) => v.claim.value)).toEqual([300])
  })

  it('truth-teller-balanced: the inversion — "£578 short" to a user £565 clear', () => {
    const r = validateSurplusClaims(
      'The 6-month safety net goal of £15,000 needs £2,000 a month. ' + "You're £578 short each month.",
      { freeCashFlow: 1422, requirements: [857],
        surplusOverRequired: null, stressTestGap: null, paceComputable: true },
    )
    expect(r.valid).toBe(false)
    expect(r.violations[0].reason).toContain('covers every monthly requirement')
  })

  it('truth-teller-balanced rerun: "£245 short" from recomputing the requirement wrongly', () => {
    // Nova ignored the £3,000 already saved: 15000/9 = 1667 instead of 12000/9 = 1333.
    const r = validateSurplusClaims(
      "The goal needs £1,667 a month. At £1,422, you're £245 short each month.",
      { freeCashFlow: 1422, requirements: [1333],
        surplusOverRequired: null, stressTestGap: null, paceComputable: true },
    )
    expect(r.valid).toBe(false)
    expect(r.violations.map((v) => v.claim.value)).toEqual([245])
  })

  it('flags a shortfall of the wrong SIZE when a real deficit exists', () => {
    const r = validateSurplusClaims("you're £62 short", {
      freeCashFlow: 1000, requirements: [1210],
      surplusOverRequired: null, stressTestGap: null, paceComputable: true,
    })
    expect(r.valid).toBe(false)
    expect(r.violations[0].reason).toContain('are [210]')
  })

  it('flags a numeric claim asserted while a supply_input blocker gates the math', () => {
    const r = validateSurplusClaims("The goal needs a target date. You're £400 short each month.", {
      freeCashFlow: 1422, requirements: [],
      surplusOverRequired: null, stressTestGap: null, paceComputable: false,
    })
    expect(r.valid).toBe(false)
    expect(r.violations[0].reason).toContain('not computable')
  })

  it('flags claimed headroom when nothing is funded (the inverse error)', () => {
    const r = validateSurplusClaims('covers it with £300 to spare', {
      freeCashFlow: 900, requirements: [1200],
      surplusOverRequired: null, stressTestGap: null, paceComputable: true,
    })
    expect(r.valid).toBe(false)
    expect(r.violations[0].reason).toContain('covers none of the monthly requirements')
  })

  it('still honours a real stressTestGap when the lever IS present', () => {
    const r = validateSurplusClaims("you're £62 short", {
      freeCashFlow: 1000, requirements: [1210],
      surplusOverRequired: 0, stressTestGap: 210, paceComputable: true,
    })
    expect(r.valid).toBe(false)
    expect(r.violations[0].reason).toContain('computed stressTestGap is 210')
  })
})

describe('validateSurplusClaims — stays quiet on correct Reads', () => {
  it('accepts the real Claude builder-classic Read (two scenario headrooms, no shortfall)', () => {
    const r = validateSurplusClaims(
      'At the 7% plan, £1,470 covers £1,187 with £283 to spare. The goal is funded. ' +
        'The stress test at 4% is also covered — £1,470 clears £1,249 with £221 left.',
      { freeCashFlow: 1470, requirements: [1249, 1187, 1126],
        surplusOverRequired: null, stressTestGap: null, paceComputable: true },
    )
    expect(r.valid).toBe(true)
    expect(r.claims.map((c) => c.value).sort((a, b) => a - b)).toEqual([221, 283])
  })

  it('accepts a shortfall that matches a real deficit', () => {
    const r = validateSurplusClaims("you're £210 short", {
      freeCashFlow: 1000, requirements: [1210],
      surplusOverRequired: null, stressTestGap: null, paceComputable: true,
    })
    expect(r.valid).toBe(true)
  })

  it('accepts a shortfall within the ±1 rounding tolerance', () => {
    const r = validateSurplusClaims("you're £211 short", {
      freeCashFlow: 1000, requirements: [1210],
      surplusOverRequired: null, stressTestGap: null, paceComputable: true,
    })
    expect(r.valid).toBe(true)
  })

  it('accepts a blocker Read that names the missing input without asserting a figure', () => {
    const r = validateSurplusClaims(
      'The move-home fund needs €4,800 more to hit €6,000 — but the one thing between you and ' +
        'knowing the monthly pace is a target date.',
      { freeCashFlow: 906, requirements: [],
        surplusOverRequired: null, stressTestGap: null, paceComputable: false },
    )
    expect(r.valid).toBe(true)
    expect(r.claims).toEqual([])
  })

  it('skips — and says so — when there is no goal context at all', () => {
    const r = validateSurplusClaims('you are £62 short', {
      freeCashFlow: null, requirements: [],
      surplusOverRequired: null, stressTestGap: null, paceComputable: true,
    })
    expect(r.skipped).toBe(true)
    expect(r.valid).toBe(true)
    // The caller warns on this: claims present with nothing to check them against.
    expect(r.claims).toHaveLength(1)
  })
})
