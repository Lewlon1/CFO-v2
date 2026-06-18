import { describe, it, expect } from 'vitest';
import { extractCompositionMetadata, buildGoalSummary } from '../compose-first-read';
import {
  buildFirstReadUserPrompt,
  FIRST_READ_SYSTEM_PROMPT,
  FIRST_READ_SYSTEM_PROMPT_VALUE_FIRST,
  FIRST_READ_SYSTEM_PROMPT_RECOMPOSE,
  type FirstReadComposeInput,
} from '../prompts/first-read';
import type { ClusterBehaviour } from '@/lib/analytics/cluster-behaviour/types';

function mockCluster(name: string): ClusterBehaviour {
  return {
    cluster_type: 'merchant',
    cluster_id: name,
    window_days: 90,
    data_completeness: 1,
    transaction_count: 14,
    total_amount: -117.6,
    recurrence: {
      median_interval_days: 6,
      interval_stddev: 1,
      regularity_score: 0.8,
      pattern_label: 'weekly',
      confidence: 0.9,
    },
    trend: {
      slope_amount_per_month: 5,
      slope_percent_per_month: 18,
      direction: 'climbing',
      confidence: 0.7,
    },
    time_pattern: {
      weekday_share: 0.85,
      day_of_week_distribution: { 0: 0, 1: 0.1, 2: 0.2, 3: 0.5, 4: 0.1, 5: 0.1, 6: 0 },
      dominant_day: 3,
      has_weekday_skew: true,
      confidence: 0.8,
    },
    amount_profile: {
      mean_amount: 8.4,
      stddev_amount: 3,
      coefficient_of_variation: 0.36,
      min_amount: 4,
      max_amount: 18,
      consistency_label: 'variable',
      confidence: 0.9,
    },
    lifecycle: {
      first_seen: '2026-02-01',
      last_seen: '2026-04-25',
      days_since_last: 4,
      status: 'active',
      appeared_within_window: false,
      confidence: 1,
    },
    summary: 'placeholder summary',
  };
}

describe('extractCompositionMetadata', () => {
  it('detects trend citation', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'Your **Pollo Tropical** spending is climbing 18% a month.',
      usableClusters: [mockCluster('POS PURCHASE POLLO TROPICAL #142')],
      goalSummary: null,
    });
    expect(md.features_cited).toContain('trend');
  });

  it('detects recurrence citation', () => {
    const md = extractCompositionMetadata({
      composedMessage: '**Pret** every 6 days like clockwork.',
      usableClusters: [mockCluster('POS PURCHASE Pret')],
      goalSummary: null,
    });
    expect(md.features_cited).toContain('recurrence');
  });

  it('detects time_pattern citation', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'Mostly weekday mornings at **Starbucks**.',
      usableClusters: [mockCluster('POS PURCHASE Starbucks')],
      goalSummary: null,
    });
    expect(md.features_cited).toContain('time_pattern');
  });

  it('detects lifecycle citation', () => {
    const md = extractCompositionMetadata({
      composedMessage: '**iCloud** first appeared in April.',
      usableClusters: [mockCluster('POS PURCHASE iCloud')],
      goalSummary: null,
    });
    expect(md.features_cited).toContain('lifecycle');
  });

  it('detects amount_profile citation', () => {
    const md = extractCompositionMetadata({
      composedMessage: '**Pollo Tropical** — mean £8.40, range £4–£18.',
      usableClusters: [mockCluster('POS PURCHASE POLLO TROPICAL #142')],
      goalSummary: null,
    });
    expect(md.features_cited).toContain('amount_profile');
  });

  it('flags gap_present when Value Map quadrant and divergence are both named', () => {
    const md = extractCompositionMetadata({
      composedMessage:
        'You called dining a Leak in the Value Map. It is climbing 18% a month. What is changing?',
      usableClusters: [],
      goalSummary: null,
    });
    expect(md.gap_present).toBe(true);
  });

  it('does not flag gap_present for plain observations', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'You have 233 transactions across 90 days.',
      usableClusters: [],
      goalSummary: null,
    });
    expect(md.gap_present).toBe(false);
  });

  it('includes L5 when goalSummary present', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'You have a clear plan.',
      usableClusters: [],
      goalSummary: 'Clear the debt · target 15000 · by 2030-05-18',
    });
    expect(md.layers_used).toContain('L5');
  });

  it('omits L5 when no goal', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'You have 233 transactions.',
      usableClusters: [],
      goalSummary: null,
    });
    expect(md.layers_used).not.toContain('L5');
  });

  it('always includes L1, L2, L3', () => {
    const md = extractCompositionMetadata({
      composedMessage: '',
      usableClusters: [],
      goalSummary: null,
    });
    expect(md.layers_used).toEqual(['L1', 'L2', 'L3']);
  });

  it('detects clusters_referenced by normalised brand probe', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'Your **POLLO TROPICAL** spending climbed in March.',
      usableClusters: [mockCluster('POS PURCHASE POLLO TROPICAL #142')],
      goalSummary: null,
    });
    expect(md.clusters_referenced.length).toBeGreaterThan(0);
  });

  it('persists read_recipe when passed', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'Here is where your money goes.',
      usableClusters: [],
      goalSummary: null,
      readRecipe: 'visibility',
    });
    expect(md.read_recipe).toBe('visibility');
  });

  it('defaults read_recipe to null and breakdown_cited to false', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'A plain read.',
      usableClusters: [],
      goalSummary: null,
    });
    expect(md.read_recipe).toBeNull();
    expect(md.breakdown_cited).toBe(false);
  });

  it('flags breakdown_cited when a top-category slug surfaces in the prose', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'Most of your spend is groceries — £450 over the window.',
      usableClusters: [],
      goalSummary: null,
      spendingBreakdown: {
        total_spend: 600,
        window_days: 90,
        top_categories: [{ category: 'groceries', total: 450, pct: 75 }],
        biggest_merchant: { name: 'ALDI', total: 200, txn_count: 8 },
        largest_transaction: { merchant: 'ALDI', amount: 60, date: '2026-04-01' },
        uncategorised_pct: 0,
      },
    });
    expect(md.breakdown_cited).toBe(true);
  });

  it('flags breakdown_cited via the slug spaced form (dining out)', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'Your dining out is climbing.',
      usableClusters: [],
      goalSummary: null,
      spendingBreakdown: {
        total_spend: 600,
        window_days: 90,
        top_categories: [{ category: 'dining_out', total: 300, pct: 50 }],
        biggest_merchant: null,
        largest_transaction: null,
        uncategorised_pct: 0,
      },
    });
    expect(md.breakdown_cited).toBe(true);
  });

  it('flags breakdown_cited when the biggest-merchant total appears', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'You spent 200 at one place.',
      usableClusters: [],
      goalSummary: null,
      spendingBreakdown: {
        total_spend: 600,
        window_days: 90,
        top_categories: [{ category: 'misc', total: 600, pct: 100 }],
        biggest_merchant: { name: 'ALDI', total: 200, txn_count: 8 },
        largest_transaction: null,
        uncategorised_pct: 0,
      },
    });
    expect(md.breakdown_cited).toBe(true);
  });

  it('does not flag breakdown_cited when the breakdown is absent', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'You spent 200 somewhere.',
      usableClusters: [],
      goalSummary: null,
      spendingBreakdown: null,
    });
    expect(md.breakdown_cited).toBe(false);
  });

  it('sets is_recompose and a false repeated_opening on a well-formed delta', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'Your sorting just made the picture legible. Dining is your biggest leak.\n\n— C.',
      usableClusters: [],
      goalSummary: null,
      mode: 'value_first_recompose',
      priorReadSummary: {
        layer1Stated: true,
        goalStatedAsReveal: true,
        merchantsAlreadyNamed: ['Tesco'],
        hookMerchantsUsed: ['Uber'],
        firstSentence: 'You bring in 3000 a month, with 1800 going to fixed costs.',
      },
    });
    expect(md.is_recompose).toBe(true);
    expect(md.repeated_opening).toBe(false);
    expect(md.mode).toBe('value_first_recompose');
  });

  it('flags repeated_opening when the recompose reopens on the prior first sentence', () => {
    const prior = 'You bring in 3000 a month, with 1800 going to fixed costs.';
    const md = extractCompositionMetadata({
      composedMessage: `${prior} And here we are again.\n\n— C.`,
      usableClusters: [],
      goalSummary: null,
      mode: 'value_first_recompose',
      priorReadSummary: {
        layer1Stated: true,
        goalStatedAsReveal: true,
        merchantsAlreadyNamed: [],
        hookMerchantsUsed: [],
        firstSentence: prior,
      },
    });
    expect(md.repeated_opening).toBe(true);
  });

  it('leaves is_recompose false and repeated_opening false in default/value_first modes', () => {
    const md = extractCompositionMetadata({
      composedMessage: 'A normal first read.',
      usableClusters: [],
      goalSummary: null,
      mode: 'value_first',
    });
    expect(md.is_recompose).toBe(false);
    expect(md.repeated_opening).toBe(false);
  });
});

describe('buildFirstReadUserPrompt — recompose mode', () => {
  const baseInput: FirstReadComposeInput = {
    userId: 'u1',
    valueProfile: {
      by_category: {},
      signal_count: {},
      by_merchant: { Dining: { foundation: 0, investment: 0, leak: 1, burden: 0 } },
      signal_count_by_merchant: { Dining: 3 },
      has_value_map: true,
      has_any_leak_signal: true,
    },
    goalSummary: 'House deposit · target 20000 · by 2027-01-01',
    topClusterBehaviours: [],
    transactionCountTotal: 120,
    windowDays: 90,
    dataWindowEnd: '2026-03-31',
    dataAgeDays: 5,
    financialFacts: {
      net_monthly_income: 3000,
      monthly_rent: 1200,
      total_fixed_costs: 1800,
      free_cash_flow: 1200,
      currency: 'EUR',
      income_shape: null,
      t3m_income_monthly: null,
      income_provenance: null,
    },
    spendingBreakdown: null,
    readRecipe: 'visibility',
  };

  it('renders ALREADY SAID + WHAT THE USER JUST SORTED when priorReadSummary present', () => {
    const prompt = buildFirstReadUserPrompt({
      ...baseInput,
      priorReadSummary: {
        layer1Stated: true,
        goalStatedAsReveal: true,
        merchantsAlreadyNamed: ['Tesco', 'Uber'],
        hookMerchantsUsed: ['Uber'],
        firstSentence: 'You bring in 3000 a month.',
      },
      valueMapCardKeys: ['Dining', 'Tesco', 'Uber'],
    });
    expect(prompt).toContain('WHAT THE USER JUST SORTED');
    expect(prompt).toContain('ALREADY SAID');
    expect(prompt).toContain('Tesco');
    expect(prompt).toContain('COMPOSE THE RECOMPOSE NOW');
    expect(prompt).toContain('[CTA:open_chat]');
    // The hook is done — no HOOK CANDIDATES section in recompose mode.
    expect(prompt).not.toContain('HOOK CANDIDATES');
  });

  it('omits the recompose sections for a normal first read', () => {
    const prompt = buildFirstReadUserPrompt(baseInput);
    expect(prompt).not.toContain('WHAT THE USER JUST SORTED');
    expect(prompt).not.toContain('ALREADY SAID');
    expect(prompt).toContain('COMPOSE THE FIRST READ NOW');
  });

  // Phase 2 regression — the recompose must NOT re-instruct the goal-math LEAD.
  // Under the 'target' recipe the first Read's formatReadFocus told the model to
  // re-lead on "FCF vs the contribution the goal needs … show the range", which
  // made the recompose restate the €948/€1,514 band the first Read already gave.
  it('recompose under the target recipe leads on the sort delta, not the goal-math band', () => {
    const prompt = buildFirstReadUserPrompt({
      ...baseInput,
      readRecipe: 'target',
      goalSummary:
        'House deposit · target 20000 · by 2027-01-01\n' +
        'Monthly contribution needed, accounting for COMPOUND GROWTH: 948/mo at 7%, 1514/mo at 4%. ' +
        'Give a clear verdict on whether the target is realistic.',
      priorReadSummary: {
        layer1Stated: true,
        goalStatedAsReveal: true,
        merchantsAlreadyNamed: ['Tesco', 'Uber'],
        hookMerchantsUsed: ['Uber'],
        firstSentence: 'You bring in 3000 a month.',
      },
    });
    // Recompose READ FOCUS replaces the first-read 'target' focus…
    expect(prompt).toContain('Do NOT re-lead on them or restate the band');
    // …so the first-read 'target' focus instruction must be absent.
    expect(prompt).not.toContain('LEAD with where they stand against it');
    // GOAL + FINANCIAL FACTS are re-labelled as already-delivered context.
    expect(prompt).toContain('ALREADY DELIVERED in the first Read');
    expect(prompt).toContain('do not re-open on income / fixed costs / FCF');
  });

  it('the recompose system prompt bans goal-math restatement + circular echo and carries the boundary and shape', () => {
    expect(FIRST_READ_SYSTEM_PROMPT_RECOMPOSE).toContain('Re-delivering the goal math');
    expect(FIRST_READ_SYSTEM_PROMPT_RECOMPOSE).toContain("Echoing the user's classification back");
    expect(FIRST_READ_SYSTEM_PROMPT_RECOMPOSE).toContain('never an instruction to fund a product');
    expect(FIRST_READ_SYSTEM_PROMPT_RECOMPOSE).toContain('compound-growth band');
    // §10 — the re-derived few-shot SHAPE travels with the changed rules.
    expect(FIRST_READ_SYSTEM_PROMPT_RECOMPOSE).toContain('Your sort just made the shape legible');
  });
});

describe('buildFirstReadUserPrompt — data sufficiency (single-month caveat + coverage-based /mo)', () => {
  const thinInput: FirstReadComposeInput = {
    userId: 'u1',
    valueProfile: {
      by_category: {},
      signal_count: {},
      by_merchant: {},
      signal_count_by_merchant: {},
      has_value_map: false,
      has_any_leak_signal: false,
    },
    goalSummary: null,
    topClusterBehaviours: [mockCluster('TESCO')], // total_amount -117.6, weekly
    transactionCountTotal: 71,
    windowDays: 90,
    dataWindowStart: '2026-04-01',
    dataWindowEnd: '2026-04-30',
    dataAgeDays: 35,
    coveredDays: 30,
    monthsSpanned: 1,
    effectiveMonths: 1,
    spendingBreakdown: null,
    readRecipe: 'open',
  };

  it('flags a single month explicitly and frames figures as that month', () => {
    const prompt = buildFirstReadUserPrompt(thinInput);
    expect(prompt).toContain('SINGLE MONTH OF DATA');
    expect(prompt).toContain('in April'); // monthName(dataWindowStart)
    expect(prompt).toContain('Data coverage: 30 days');
  });

  it('normalises cluster /mo by actual coverage (not the 90d window) and drops the recurring nudge', () => {
    const prompt = buildFirstReadUserPrompt(thinInput);
    // total 117.6 over one month → ≈118/mo "over 30d", NOT 117.6/2.957≈40 "over 90d".
    expect(prompt).toContain('over 30d');
    expect(prompt).not.toContain('over 90d');
    // Recurrence can't be established on one month → no "prefer the /mo figure" nudge.
    expect(prompt).not.toContain('prefer the /mo figure');
  });

  it('both first-read system prompts ban fabricated day-spans (the "over 52 days" hallucination)', () => {
    for (const sys of [FIRST_READ_SYSTEM_PROMPT, FIRST_READ_SYSTEM_PROMPT_VALUE_FIRST]) {
      expect(sys).toContain('Cite ONLY day-counts and date spans that appear verbatim');
      expect(sys).toContain('over 52 days');
    }
  });

  it('does not caveat when coverage is a full quarter', () => {
    const prompt = buildFirstReadUserPrompt({
      ...thinInput,
      coveredDays: 90,
      monthsSpanned: 3,
      effectiveMonths: 90 / 30.44,
    });
    expect(prompt).not.toContain('SINGLE MONTH OF DATA');
    expect(prompt).toContain('enough for monthly figures');
  });
});

describe('buildGoalSummary — investment goal locks the 7% plan', () => {
  it('shows the band, locks 7% as the plan, explains where it comes from, and reframes 4% as the stress case', () => {
    const summary = buildGoalSummary(
      {
        name: 'Retirement pot',
        target_amount: 500000,
        current_amount: 70000,
        target_date: '2041-06-01',
        type: 'investment',
        monthly_required_saving: null,
      },
      'EUR',
    );
    // The full range is still shown (the options matter)…
    expect(summary).toContain('at 4%');
    expect(summary).toContain('at 7%');
    expect(summary).toContain('at 10%');
    // …then 7% is locked as the working plan, and we size against it, not 4%.
    expect(summary).toContain('PLAN AROUND the 7%');
    expect(summary).toContain('not the 4% figure');
    // …with a one-line justification of where 7% comes from…
    expect(summary).toContain('where the 7% comes from');
    // …and the conservative case demoted to a stress test, not the default.
    expect(summary).toMatch(/stress test/);
  });

  it('leaves non-investment goals on the straight-line line (no rate band, no lock-in)', () => {
    const summary = buildGoalSummary(
      {
        name: 'Emergency fund',
        target_amount: 10000,
        current_amount: 0,
        target_date: '2027-01-01',
        type: 'savings',
        monthly_required_saving: 400,
      },
      'EUR',
    );
    expect(summary).not.toContain('PLAN AROUND the 7%');
    expect(summary).toContain('straight-line');
  });
});
