import { describe, it, expect } from 'vitest';
import {
  buildFirstReadUserPrompt,
  FIRST_READ_SYSTEM_PROMPT_DECLARED_UPGRADE,
  type FirstReadComposeInput,
  type PriorReadSummary,
} from '../prompts/first-read';
import {
  isDeclaredUpgradeInsufficient,
  declaredUpgradeDeclineResult,
} from '../compose-first-read';
import { checkReadHardRules } from '../read-judge';
import type { ClusterBehaviour } from '@/lib/analytics/cluster-behaviour/types';
import type { HookCandidate } from '@/lib/ai/compose-first-read-hooks';

function mockCluster(name: string): ClusterBehaviour {
  return {
    cluster_type: 'merchant',
    cluster_id: name,
    window_days: 90,
    data_completeness: 1,
    transaction_count: 14,
    total_amount: -680,
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
      mean_amount: 48.5,
      stddev_amount: 12,
      coefficient_of_variation: 0.25,
      min_amount: 12,
      max_amount: 120,
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

function mockHook(label: string): HookCandidate {
  return {
    cluster_id: label.toLowerCase(),
    label,
    recent_amount: 431,
    period_hint: 'visible but unread',
    candidate_quadrants: ['investment', 'leak'],
  };
}

const declaredPrior: PriorReadSummary = {
  // The declared Read stated income / fixed costs / free cash as standing facts.
  layer1Stated: true,
  // It revealed the goal target + pace.
  goalStatedAsReveal: true,
  // The declared Read saw NO transactions, so it named no merchants.
  merchantsAlreadyNamed: [],
  hookMerchantsUsed: [],
  firstSentence: 'You bring in about €3,100 a month, and the fixed costs you listed come to €1,850.',
};

const baseInput: FirstReadComposeInput = {
  userId: 'u1',
  mode: 'declared_upgrade',
  valueProfile: {
    by_category: {},
    signal_count: {},
    by_merchant: {},
    signal_count_by_merchant: {},
    has_value_map: false,
    has_any_leak_signal: false,
  },
  goalSummary: 'House deposit · target 20000 · by 2027-01-01',
  topClusterBehaviours: [mockCluster('POS PURCHASE EATING OUT')],
  transactionCountTotal: 240,
  windowDays: 90,
  dataWindowStart: '2026-02-01',
  dataWindowEnd: '2026-04-30',
  dataAgeDays: 5,
  coveredDays: 90,
  monthsSpanned: 3,
  effectiveMonths: 90 / 30.44,
  financialFacts: {
    net_monthly_income: 3100,
    monthly_rent: 1200,
    total_fixed_costs: 1850,
    free_cash_flow: 1250,
    currency: 'EUR',
    income_shape: null,
    t3m_income_monthly: null,
  },
  spendingBreakdown: {
    total_spend: 3000,
    window_days: 90,
    top_categories: [{ category: 'dining_out', total: 900, pct: 30 }],
    biggest_merchant: { name: 'EATING OUT', total: 680, txn_count: 14 },
    largest_transaction: { merchant: 'EATING OUT', amount: 120, date: '2026-04-01' },
    uncategorised_pct: 10,
  },
  hookCandidates: [mockHook('Aldi'), mockHook('Uber')],
  readRecipe: 'target',
  priorReadSummary: declaredPrior,
};

describe('buildFirstReadUserPrompt — declared_upgrade mode', () => {
  it('renders the declared ALREADY SAID block (do-not-restate income/fixed/free-cash/goal-pace)', () => {
    const prompt = buildFirstReadUserPrompt(baseInput);
    expect(prompt).toContain('ALREADY SAID');
    // It must scope the do-not-restate contract to the DECLARED facts.
    expect(prompt).toContain('declared');
    // The declared free-cash figure was already announced — do not re-open on it.
    expect(prompt).toContain('do not re-open on income / fixed costs / FCF');
    expect(prompt).toContain('COMPOSE THE DECLARED UPGRADE');
  });

  it('renders NO Value-Map-sort block (the sort did not happen on this path)', () => {
    const prompt = buildFirstReadUserPrompt(baseInput);
    expect(prompt).not.toContain('WHAT THE USER JUST SORTED');
    // It must NOT use the recompose READ FOCUS or the open_chat CTA.
    expect(prompt).not.toContain('Do NOT re-lead on them or restate the band');
    expect(prompt).not.toContain('COMPOSE THE RECOMPOSE NOW');
    expect(prompt).not.toContain('[CTA:open_chat]');
  });

  it('closes on the Value Map CTA and renders the real spending breakdown + clusters', () => {
    const prompt = buildFirstReadUserPrompt(baseInput);
    expect(prompt).toContain('[CTA:start_value_map_real]');
    // Real transaction layers are present.
    expect(prompt).toContain('SPENDING BREAKDOWN');
    expect(prompt).toContain('BEHAVIOURAL CLUSTERS');
    expect(prompt).toContain('HOOK CANDIDATES');
  });

  it('does not re-open on the declared free-cash figure as a new reveal', () => {
    const prompt = buildFirstReadUserPrompt(baseInput);
    // FINANCIAL FACTS is re-labelled as already-delivered context in this mode.
    expect(prompt).toContain('ALREADY DELIVERED in the declared Read');
  });
});

describe('FIRST_READ_SYSTEM_PROMPT_DECLARED_UPGRADE', () => {
  it('leads on the declared→actual delta and closes on start_value_map_real', () => {
    expect(FIRST_READ_SYSTEM_PROMPT_DECLARED_UPGRADE).toContain('start_value_map_real');
    // Leads on the delta payoff, not a re-statement of the declared picture.
    expect(FIRST_READ_SYSTEM_PROMPT_DECLARED_UPGRADE).toMatch(/told me/i);
    expect(FIRST_READ_SYSTEM_PROMPT_DECLARED_UPGRADE).toMatch(/statements show/i);
  });

  it('carries an ALREADY-SAID / do-not-restate contract scoped to the declared facts', () => {
    expect(FIRST_READ_SYSTEM_PROMPT_DECLARED_UPGRADE).toContain('ALREADY SAID');
    expect(FIRST_READ_SYSTEM_PROMPT_DECLARED_UPGRADE).toContain('— C.');
  });

  it('carries its own re-derived SHAPE TO AIM FOR block (not the value_first or recompose one)', () => {
    expect(FIRST_READ_SYSTEM_PROMPT_DECLARED_UPGRADE).toContain('SHAPE TO AIM FOR');
    // It must NOT copy the value_first or recompose shape openers.
    expect(FIRST_READ_SYSTEM_PROMPT_DECLARED_UPGRADE).not.toContain(
      'Your sort just made the shape legible',
    );
    expect(FIRST_READ_SYSTEM_PROMPT_DECLARED_UPGRADE).not.toContain(
      'Your free cash flow is €1,238 a month',
    );
  });
});

describe('declared_upgrade hard-rule compliance (read-judge, mode value_first)', () => {
  // Mode coupling: declared_upgrade reuses value_first's hard-rule contract (same
  // single start_value_map_real close), so it is judged under mode 'value_first'.
  // If the two ever diverge, update both this test and read-judge together.
  // A representative declared_upgrade-shaped Read. Single start_value_map_real
  // close, no question-final sentence, ≤250 words, "— C." on its own line.
  const sampleRead = `You told me your fixed costs ran about €1,850 a month. The statements say €2,140 — the standing bills you listed missed roughly €290 a month in committed spend.

That changes the free-cash picture. **Eating out** ran €680 over the window, the single biggest discretionary line and bigger than the cushion your declared numbers implied. The deposit's room is thinner than the paper figure suggested.

Two things the statements raise that your declared numbers couldn't:
– **Aldi**, €431 — primary shop, or a top-up alongside another?
– **Uber**, €174 — one-off, or a habit forming?

Once those land, the Value Map is where this spending gets weighed against what you actually value.

[CTA:start_value_map_real]Tell me what these mean[/CTA]
— C.`;

  it('passes the hard rules under mode value_first', () => {
    const rules = checkReadHardRules(sampleRead, { mode: 'value_first' });
    const failed = rules.filter((r) => !r.passed);
    expect(failed).toEqual([]);
  });

  it('has exactly one start_value_map_real CTA, no question close, within the word cap', () => {
    const rules = checkReadHardRules(sampleRead, { mode: 'value_first' });
    const byId = Object.fromEntries(rules.map((r) => [r.ruleId, r]));
    expect(byId['H3_exactly_one_cta'].passed).toBe(true);
    expect(byId['H3b_value_first_cta_type'].passed).toBe(true);
    expect(byId['H5_no_question_close'].passed).toBe(true);
    expect(byId['H2_within_word_cap'].passed).toBe(true);
    expect(byId['H1_signoff_present'].passed).toBe(true);
  });
});

describe('isDeclaredUpgradeInsufficient — decline-on-thin predicate', () => {
  const oneCluster = [mockCluster('TESCO')];
  const oneHook = [mockHook('Aldi')];

  it('returns true when there are no usable clusters', () => {
    expect(isDeclaredUpgradeInsufficient([], oneHook)).toBe(true);
  });

  it('returns true when there are no hook candidates', () => {
    expect(isDeclaredUpgradeInsufficient(oneCluster, [])).toBe(true);
  });

  it('returns true when both are empty', () => {
    expect(isDeclaredUpgradeInsufficient([], [])).toBe(true);
  });

  it('returns false when both clusters and hooks are present', () => {
    expect(isDeclaredUpgradeInsufficient(oneCluster, oneHook)).toBe(false);
  });
});

describe('declaredUpgradeDeclineResult — decline-on-thin RETURN contract', () => {
  // The route keys off composed.insufficientData to skip appending an upgrade and
  // leave the declared Read as the last word. Lock that contract here so the
  // compose-layer decline return — not just the predicate — is covered.
  it('flags insufficientData with an empty message and the declared_upgrade mode', () => {
    const result = declaredUpgradeDeclineResult('target');
    expect(result.insufficientData).toBe(true);
    expect(result.composedMessage).toBe('');
    expect(result.metadata.mode).toBe('declared_upgrade');
  });

  it('threads the read recipe through and stays a non-recompose, non-hook decline', () => {
    const result = declaredUpgradeDeclineResult('control');
    expect(result.metadata.read_recipe).toBe('control');
    expect(result.metadata.is_recompose).toBe(false);
    expect(result.metadata.hook_candidates).toBeNull();
    expect(result.metadata.clusters_referenced).toEqual([]);
  });

  it('accepts a null recipe (no goal/entry context) without breaking the contract', () => {
    const result = declaredUpgradeDeclineResult(null);
    expect(result.insufficientData).toBe(true);
    expect(result.metadata.read_recipe).toBeNull();
  });
});
