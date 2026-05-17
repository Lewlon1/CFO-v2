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

  it('fails on "€500/year saved" with no propose_experiment result', () => {
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
