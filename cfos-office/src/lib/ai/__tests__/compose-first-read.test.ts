import { describe, it, expect } from 'vitest';
import {
  extractCompositionMetadata,
  buildGoalSummary,
  reconcileLeverPackageWithFacts,
  type FinancialFacts,
} from '../compose-first-read';
import type { Lever, LeverPackage } from '@/lib/analytics/levers';
import {
  buildFirstReadUserPrompt,
  FIRST_READ_SYSTEM_PROMPT,
  FIRST_READ_SYSTEM_PROMPT_VALUE_FIRST,
  FIRST_READ_SYSTEM_PROMPT_RECOMPOSE,
  type FirstReadComposeInput,
} from '../prompts/first-read';
import type { ClusterBehaviour } from '@/lib/analytics/cluster-behaviour/types';
import { computeGoalVerdict } from '@/lib/finance/goal-verdict';

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
      free_cash_flow_basis: 'observed',
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
  const retirementGoal = {
    name: 'Retirement pot',
    target_amount: 500000,
    current_amount: 70000,
    target_date: '2041-06-01',
    type: 'investment',
    monthly_required_saving: null,
  };
  const verdictFor = (
    goal: {
      target_amount: number | null;
      current_amount: number | null;
      target_date: string | null;
      type: string | null;
      monthly_required_saving: number | null;
    },
    freeCashFlow: number | null,
  ) => computeGoalVerdict({ goal, freeCashFlow, asOf: new Date('2026-06-01T00:00:00Z') });

  it('shows the band, locks 7% as the plan, explains where it comes from, and reframes 4% as the stress case', () => {
    const summary = buildGoalSummary(
      retirementGoal,
      'EUR',
      verdictFor(retirementGoal, 3000),
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
    const emergencyFund = {
      name: 'Emergency fund',
      target_amount: 10000,
      current_amount: 0,
      target_date: '2027-01-01',
      type: 'savings',
      monthly_required_saving: 400,
    };
    const summary = buildGoalSummary(
      emergencyFund,
      'EUR',
      verdictFor(emergencyFund, 600),
    );
    expect(summary).not.toContain('PLAN AROUND the 7%');
    expect(summary).toContain('straight-line');
    // The straight-line branch used to emit no verdict at all — now it does.
    expect(summary).toContain('FUNDED AT PLAN');
    expect(summary).toContain('€200/mo spare');
    // …and no stress case, because there is no rate band to stress.
    expect(summary).not.toContain('STRESS TEST');
  });

  // Rule 2: the verdict is handed over, never asked for. These assert on the
  // exact regression shape — a funded user told they are short.
  it('states FUNDED AT PLAN with the exact surplus, and forbids the invented gap', () => {
    const summary = buildGoalSummary(
      retirementGoal,
      'EUR',
      verdictFor(retirementGoal, 3000),
    );
    expect(summary).toContain('FUNDED AT PLAN');
    expect(summary).toContain('There is NO gap at plan');
    expect(summary).toContain('cite verbatim, NEVER recompute');
    expect(summary).not.toContain('NOT FUNDED AT PLAN');
    // No instruction anywhere asking the model to work the verdict out itself.
    expect(summary).not.toContain('Give a clear verdict');
  });

  it('states NOT FUNDED AT PLAN with a single named shortfall figure', () => {
    const verdict = verdictFor(retirementGoal, 100);
    const summary = buildGoalSummary(retirementGoal, 'EUR', verdict);
    expect(summary).toContain('NOT FUNDED AT PLAN');
    expect(summary).toContain('is the ONLY shortfall figure that may appear');
    expect(summary).toContain(`€${verdict.shortfallAtPlan!.toLocaleString('en-GB')}/mo`);
  });

  it('reports the stress case as covered rather than as a gap', () => {
    // Free cash clears even the 4% case.
    const verdict = verdictFor(retirementGoal, 99_999);
    const summary = buildGoalSummary(retirementGoal, 'EUR', verdict);
    expect(verdict.stressCovered).toBe(true);
    expect(summary).toContain('COVERS it');
    expect(summary).toContain('it is not a gap');
  });

  it('sizes the stress shortfall when the conservative case is not covered', () => {
    const probe = verdictFor(retirementGoal, 99_999);
    const between = Math.round((probe.planMonthly! + probe.stressMonthly!) / 2);
    const verdict = verdictFor(retirementGoal, between);
    const summary = buildGoalSummary(retirementGoal, 'EUR', verdict);
    expect(verdict.fundedAtPlan).toBe(true);
    expect(verdict.stressCovered).toBe(false);
    expect(summary).toContain('FUNDED AT PLAN');
    expect(summary).toContain('more than free cash flow covers');
  });

  // Rule 8. The band line used to call requiredMonthlyBand itself, off its own
  // `new Date()` — a second derivation of a fact the verdict already owned. It
  // printed £985/mo at 7% in the band and £948/mo in the verdict, leaving the
  // model to pick between two "the 7% figure"s. Both now come off the verdict.
  it('prints the same plan figure in the band line and in the verdict', () => {
    const verdict = verdictFor(retirementGoal, 3000);
    const summary = buildGoalSummary(retirementGoal, 'GBP', verdict);
    const plan = `£${verdict.planMonthly!.toLocaleString('en-GB')}`;
    expect(summary).toContain(`${plan}/mo at 7%`);
    expect(summary).toContain(`PLAN AROUND the 7% (middle) case — ${plan}/mo`);
    expect(summary).toContain(`the 7% plan figure of ${plan}/mo`);
    const stress = `£${verdict.stressMonthly!.toLocaleString('en-GB')}`;
    expect(summary).toContain(`${stress}/mo at 4%`);
    expect(summary).toContain(`4% rate, ${stress}/mo is needed`);
  });

  it('emits no verdict at all when free cash flow is unknown', () => {
    const summary = buildGoalSummary(
      retirementGoal,
      'EUR',
      verdictFor(retirementGoal, null),
    );
    expect(summary).not.toContain('VERDICT');
    expect(summary).not.toContain('STRESS TEST');
    // The band and the teaching lines still render.
    expect(summary).toContain('PLAN AROUND the 7%');
  });
});

describe('reconcileLeverPackageWithFacts — Issue 1.4 compose-time consistency assertion', () => {
  const baseFacts: FinancialFacts = {
    net_monthly_income: 3000,
    monthly_rent: 1200,
    total_fixed_costs: 1800,
    free_cash_flow: 1200,
    free_cash_flow_basis: 'observed',
    currency: 'EUR',
    income_shape: null,
    t3m_income_monthly: null,
    income_provenance: null,
  };

  const accelerateLever: Lever = {
    type: 'accelerate',
    goalId: 'g1',
    goalName: 'House deposit',
    surplusOverRequired: 700,
    stressTestGap: null,
    basis: 'observed',
  };

  function packageWith(lever: Lever): LeverPackage {
    return { levers: [lever], blocker: null };
  }

  it('keeps the lever when it reconciles with FINANCIAL FACTS (free_cash_flow − required)', () => {
    // free_cash_flow 1200 − required 500 = 700, matches the lever exactly.
    const result = reconcileLeverPackageWithFacts(
      packageWith(accelerateLever),
      baseFacts,
      { id: 'g1', monthly_required_saving: 500 },
      'user-1',
    );
    expect(result.levers).toHaveLength(1);
    expect(result.levers[0]).toBe(accelerateLever);
  });

  it('tolerates a 1-unit rounding gap', () => {
    const result = reconcileLeverPackageWithFacts(
      packageWith({ ...accelerateLever, surplusOverRequired: 699 }),
      baseFacts,
      { id: 'g1', monthly_required_saving: 500 },
      'user-1',
    );
    expect(result.levers).toHaveLength(1);
  });

  it('drops the lever when it disagrees with FINANCIAL FACTS beyond tolerance (the dorcas/lewis bug class)', () => {
    // free_cash_flow 1200 − required 500 = 700 expected; the lever claims 2867 —
    // exactly the shape of the false "funded / spare cash" figures the review caught.
    const result = reconcileLeverPackageWithFacts(
      packageWith({ ...accelerateLever, surplusOverRequired: 2867 }),
      baseFacts,
      { id: 'g1', monthly_required_saving: 500 },
      'user-1',
    );
    expect(result.levers.find((l) => l.type === 'accelerate')).toBeUndefined();
    expect(result.levers).toHaveLength(0);
  });

  it('leaves non-accelerate levers (cut, supply_input) untouched', () => {
    const cutLever: Lever = {
      type: 'cut',
      category: 'eating & drinking out',
      currentMonthly: 400,
      suggestedCut: 100,
      goalImpactMonths: 2,
      goalId: 'g1',
    };
    const result = reconcileLeverPackageWithFacts(
      packageWith(cutLever),
      baseFacts,
      { id: 'g1', monthly_required_saving: 500 },
      'user-1',
    );
    expect(result.levers).toHaveLength(1);
    expect(result.levers[0]).toBe(cutLever);
  });

  it('is a no-op when free_cash_flow or monthly_required_saving is unavailable', () => {
    const result = reconcileLeverPackageWithFacts(
      packageWith(accelerateLever),
      { ...baseFacts, free_cash_flow: null },
      { id: 'g1', monthly_required_saving: 500 },
      'user-1',
    );
    expect(result.levers).toHaveLength(1);
  });

  it('drops the lever when it is for a DIFFERENT goal than the Read (goal-selection mismatch)', () => {
    // The lever engine and getActiveGoal resolve "the" active goal via two
    // separate queries — a user with 2+ active goals could have them
    // disagree. Numbers "matching" here would be coincidence, not proof.
    const result = reconcileLeverPackageWithFacts(
      packageWith(accelerateLever), // goalId: 'g1'
      baseFacts, // free_cash_flow 1200, which would "match" 700 required 500 by luck
      { id: 'g2', monthly_required_saving: 500 }, // the Read is about a DIFFERENT goal
      'user-1',
    );
    expect(result.levers.find((l) => l.type === 'accelerate')).toBeUndefined();
  });

  it('does not drop the lever when goalRow.id is null (id not threaded through, e.g. legacy caller)', () => {
    const result = reconcileLeverPackageWithFacts(
      packageWith(accelerateLever),
      baseFacts,
      { id: null, monthly_required_saving: 500 },
      'user-1',
    );
    expect(result.levers).toHaveLength(1);
  });
});

describe('buildFirstReadUserPrompt — Issue 5: declared-income hedge', () => {
  const minimalInput: FirstReadComposeInput = {
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
    topClusterBehaviours: [],
    transactionCountTotal: 240,
    windowDays: 90,
    dataWindowEnd: '2026-04-30',
    dataAgeDays: 5,
    financialFacts: {
      net_monthly_income: 3200,
      monthly_rent: 1200,
      total_fixed_costs: 1492,
      free_cash_flow: 1708,
      free_cash_flow_basis: 'modelled',
      currency: 'EUR',
      income_shape: null,
      t3m_income_monthly: 0,
      income_provenance: 'declared_unverified',
    },
    spendingBreakdown: null,
    readRecipe: 'visibility',
  };

  it('renders the declared-not-observed hedge when income_provenance is declared_unverified (declared income, zero observed income)', () => {
    const prompt = buildFirstReadUserPrompt(minimalInput);
    expect(prompt).toContain('DECLARED by the user, NOT seen landing');
    expect(prompt).toContain('is the salary paid into another account?');
  });

  it('does NOT render the hedge when income_provenance is observed', () => {
    const prompt = buildFirstReadUserPrompt({
      ...minimalInput,
      financialFacts: { ...minimalInput.financialFacts!, income_provenance: 'observed' },
    });
    expect(prompt).not.toContain('DECLARED by the user, NOT seen landing');
  });

  it('does NOT render the hedge when income_provenance is unknown/null', () => {
    const prompt = buildFirstReadUserPrompt({
      ...minimalInput,
      financialFacts: { ...minimalInput.financialFacts!, income_provenance: null },
    });
    expect(prompt).not.toContain('DECLARED by the user, NOT seen landing');
  });
});
