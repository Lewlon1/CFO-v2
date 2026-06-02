import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BASE_PERSONA } from './system-prompt';
import { getNextQuestions } from '@/lib/profiling/engine';
import type { ProfileQuestion } from '@/lib/profiling/question-registry';
import { assembleReviewContext } from './review-context';
import { PERSONALITIES, SAMPLE_TRANSACTIONS } from '@/lib/value-map/constants';
import type { InsightPayload, QuotableFact, PatternResult, ExperimentProposalLayer } from '@/lib/analytics/insight-types';
import { extractNumbers } from './insight-validator';
import { BRIDGE_USER_MSG_THRESHOLD } from '@/lib/onboarding-v2/bridge';
import { getPrimaryGoal, type PrimaryGoal } from '@/lib/goals/primary-goal';
import { currencySymbol, formatMoney } from '@/lib/format/money';
import { isChatIntelligenceV2Enabled } from '@/lib/features/chat-intelligence-v2';
import { getPosturePromptFragment } from './posture-prompts';
import { getTransformPosture } from '@/lib/analytics/posture-helpers';
import { getOpenItems, renderOpenItemsBlock } from '@/lib/conversations/open-items';
import { isLayeredReadEnabled } from '@/lib/feature-flags/layered-read';
import { createServiceClient } from '@/lib/supabase/service';
import {
  pickSignificantAmbiguousMerchant,
  type SignificantMerchant,
} from '@/lib/value-map/significant-merchant';

const COHORT_LABEL: Record<string, string> = {
  wave_1: 'Wave 1',
  wave_1_5: 'Wave 1.5',
  wave_2: 'Wave 2',
  wave_3: 'Wave 3',
  public: 'public launch',
};

/**
 * Keys whose string values are NOT merchant names — categories, day names,
 * prompt copy, structural enums. Anything else at a string position is treated
 * as a possible merchant for the validator's allowlist.
 */
const NON_MERCHANT_KEYS = new Set([
  'id', 'layer', 'currency', 'category', 'topCategory',
  'top2Category', 'outlierDay', 'outlierName', 'narrative_prompt',
  'hypothesis', 'title', 'reason', 'smallestDuplicateCategory',
]);

/**
 * Walk an arbitrary value tree and harvest every numeric value into `numbers`,
 * every plausibly-merchant-shaped string into `merchants`. The walk is
 * intentionally permissive — the validator is the gatekeeper, this just builds
 * the widest reasonable allowlist.
 */
function walkPatternData(
  node: unknown,
  numbers: Set<number>,
  merchants: Set<string>,
  parentKey: string | null,
): void {
  if (node === null || node === undefined) return;
  if (typeof node === 'number') {
    if (Number.isFinite(node) && Math.abs(node) >= 1) {
      const abs = Math.abs(node);
      numbers.add(Math.round(abs));
      // Also include the floor for decimals so "29.99" matches both 29 and 30.
      if (!Number.isInteger(abs)) numbers.add(Math.floor(abs));
    }
    return;
  }
  if (typeof node === 'string') {
    if (parentKey !== null && NON_MERCHANT_KEYS.has(parentKey)) return;
    const trimmed = node.trim();
    if (trimmed.length >= 2 && !/^\d+(?:\.\d+)?$/.test(trimmed)) {
      merchants.add(trimmed.toLowerCase());
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) walkPatternData(item, numbers, merchants, parentKey);
    return;
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      walkPatternData(v, numbers, merchants, k);
    }
  }
}

/**
 * Turn a `PatternResult` into a single QuotableFact whose `numbers` and
 * `merchants` cover everything the LLM might legitimately cite. The pattern's
 * `data` shape is heterogeneous (each detector writes its own keys), so we
 * walk recursively and harvest indiscriminately. The validator's number-
 * tolerance and merchant-allowlist intersection do the actual gating.
 *
 * `currency` is unused here — kept in the signature for future per-pattern
 * formatted strings if we ever surface them.
 */
function factsFromPattern(pattern: PatternResult, _currency: string): QuotableFact[] {
  const numbers = new Set<number>();
  const merchants = new Set<string>();
  walkPatternData(pattern.data, numbers, merchants, null);

  // Numbers that appear in the pre-resolved narrative_prompt template (e.g.
  // formatCurrency() output) may not be in `data` if the detector derived
  // them inline. Harvest them too.
  if (typeof pattern.narrative_prompt === 'string') {
    for (const n of extractNumbers(pattern.narrative_prompt)) numbers.add(n);
  }

  if (numbers.size === 0 && merchants.size === 0) return [];

  return [{
    text: pattern.narrative_prompt,
    numbers: Array.from(numbers),
    merchants: Array.from(merchants),
  }];
}

export function buildQuotableFacts(payload: InsightPayload): QuotableFact[] {
  const facts: QuotableFact[] = [];

  // Transaction count is always quotable — frequently cited as "I went through
  // all 66 of your transactions" etc.
  facts.push({
    text: `${payload.transactionCount} transactions`,
    numbers: [payload.transactionCount],
    merchants: [],
  });

  // Stat card values are already formatted correctly by the engine; we trust them
  // verbatim. Extract numeric components for validation.
  for (const card of payload.statCards) {
    const numbers = Array.from(
      card.value.matchAll(/\d[\d,]*(?:\.\d+)?/g),
    ).map((m) => Number(m[0].replace(/,/g, ''))).filter((n) => Number.isFinite(n) && n >= 10);
    facts.push({ text: card.value, numbers, merchants: [] });
  }

  // Per-pattern canonical facts
  for (const layer of ['headline', 'gap', 'numbers', 'hidden_pattern', 'action', 'hook'] as const) {
    const pattern = payload.layers[layer];
    if (!pattern) continue;
    facts.push(...factsFromPattern(pattern, payload.currency));
  }

  return facts;
}

/**
 * Build the anti-hallucination context block for the First Insight conversation.
 *
 * The system has deterministically computed patterns, stat cards, and a hook
 * from the user's transactions. This function assembles those into a prompt
 * section that STRICTLY constrains Claude to narrate only what's in the
 * payload — no inventing income, savings rate, surplus, goals, etc.
 */
const CAPABILITY_FOCUS: Record<string, string> = {
  cashflow: 'The user wants to understand where their money goes. Emphasise spending patterns, categories, and cash flow clarity. Make the hook actionable toward tracking and awareness.',
  values: 'The user wants to understand why they spend the way they do. Connect patterns to behaviour and habits. The hook should invite reflection on whether spending matches what they care about.',
  networth: 'The user wants to track what they own and owe. Where possible, frame patterns in terms of what they reveal about financial position — recurring costs as liabilities, consistent deposits as assets. Hook toward a net worth conversation.',
  scenarios: 'The user is weighing a big decision. Frame patterns in terms of financial headroom and optionality. The hook should invite a forward-looking question: "what would it take to..."',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildFirstInsightContext(payload: InsightPayload, selectedCapabilities?: string[], profile?: any): string {
  const lines: string[] = [];
  lines.push('## First insight — data from the system');
  lines.push('The following patterns were computed deterministically. You MUST narrate ONLY these patterns.');
  lines.push('');
  lines.push('STRICT RULES:');
  lines.push('- Every number you cite must appear verbatim in the QUOTABLE FACTS list below. No estimating.');
  lines.push('- Do NOT compute ratios, averages, multipliers, time spans, daily rates, or per-month figures yourself — if a derived figure is not listed in QUOTABLE FACTS, do not cite it. Rephrase qualitatively instead ("sharp spike", "a meaningful chunk") without inventing the number.');
  lines.push('- Do NOT extrapolate (e.g. "across four months" unless the months of data count shown is exactly four). Stick to what the data shows.');
  lines.push("- You do NOT know the user's income, savings rate, or surplus. Do not mention these concepts.");
  if (payload.userIntent) {
    lines.push("- You DO know the user's stated goal (see STATED GOAL below). Reference it naturally — don't list it back at them.");
    lines.push("- You do NOT know the user's age, employment, or housing type. Do not reference them.");
  } else {
    lines.push("- You do NOT know the user's age, employment, housing type, or goals. Do not reference them.");
  }
  lines.push('- You do NOT know whether their spending is "sustainable" or "affordable" — that requires income.');
  lines.push('- If a field says "not_available", you must not reference it or imply it.');
  lines.push("- Do not say \"you spend X% of your income\" — you don't know their income.");
  lines.push("- Do not say \"you have £X left over\" — you don't know what comes in.");
  lines.push('- Do not say "your savings rate is..." — you cannot compute this.');
  lines.push('- You CAN say: "Regular deposits are visible" if the income_detected pattern is present.');
  lines.push('- You CAN say: "Income figure not yet known" as part of the hook.');
  lines.push("- When in doubt: if it's not in the data below, don't say it.");
  lines.push('');
  lines.push('### Available data');
  lines.push(`- Name: ${payload.userName ?? 'unknown'}`);
  lines.push(`- Country: ${payload.country ?? 'unknown'}`);
  lines.push(`- Currency: ${payload.currency}`);
  lines.push(`- Months of data: ${payload.monthCount}`);
  lines.push(`- Total transactions: ${payload.transactionCount}`);
  lines.push(`- Value Map completed: ${payload.hasValueMap ? 'yes' : 'no'}`);
  if (payload.hasValueMap) lines.push(`- Archetype: ${payload.archetype}`);
  lines.push('');
  lines.push(`### Discipline score: ${payload.disciplineScore}/100`);
  if (payload.disciplineScore > 70) {
    lines.push('This user is financially disciplined. Lead with recognition, not correction. Position yourself as a partner who can automate monitoring and help optimise, not as a teacher finding problems.');
  } else if (payload.disciplineScore > 40) {
    lines.push('This user has some financial structure but clear areas for improvement. Balance recognition with honest observations.');
  } else {
    lines.push('This user has limited financial structure. Focus on one clear, achievable pattern. Do not overwhelm.');
  }
  lines.push('');
  // Stated goal — when the user has told us what they want from this product,
  // anchor the wow moment to it rather than narrating in the abstract.
  if (payload.userIntent) {
    const intent = payload.userIntent;
    lines.push('### STATED GOAL');
    if (intent.source === 'goal' && intent.goalName) {
      lines.push(`- The user has set a goal: "${intent.goalName}".`);
      if (intent.text && intent.text !== intent.goalName) {
        lines.push(`- In their own words: "${intent.text}"`);
      }
    } else if (intent.source === 'entry_struggle') {
      const struggleLabels: Record<string, string> = {
        wealth:    "I want to start building wealth",
        debt:      "I'm carrying debt I want to clear",
        planning:  "I'm planning for something specific",
        free_text: "(see their own words below)",
      };
      const label = intent.struggleType ? struggleLabels[intent.struggleType] : null;
      if (label) lines.push(`- At onboarding the user said: "${label}"`);
      if (intent.text) lines.push(`- In their own words: "${intent.text}"`);
    }
    lines.push('');
    lines.push('FRAME THE WOW MOMENT THROUGH THIS GOAL:');
    lines.push('- Acknowledge the goal naturally inside the opening line — paraphrase, don\'t quote. Do NOT greet, welcome, or address the user by name. The opening is the observation, with the goal woven in.');
    lines.push('- Then make the insight land *against* that goal. The leverage is in their day-to-day pattern — what\'s flowing where, and whether it\'s aligned with what they came here for.');
    lines.push('- Pick ONE specific number from the QUOTABLE FACTS list and tie it to the goal. Specifics over abstractions.');
    if (payload.userIntent.struggleType === 'wealth' ||
        (payload.userIntent.text ?? '').toLowerCase().includes('wealth') ||
        (payload.userIntent.text ?? '').toLowerCase().includes('grow')) {
      lines.push('- Wealth-building framing: "If we\'re going to actually move toward this, the leverage is in your day-to-day spending — what\'s flowing where, and whether it\'s aligned with what matters."');
    } else if (payload.userIntent.struggleType === 'debt') {
      lines.push('- Debt framing: clearing it faster comes down to surplus — what\'s left after fixed costs. Point at where surplus could come from in their pattern.');
    } else if (payload.userIntent.struggleType === 'planning') {
      lines.push('- Planning framing: to get there, they need a clear picture of what\'s leaving the account each month. The pattern below is that picture.');
    }
    lines.push('');
  }
  // Quotable facts — the ONLY strings containing numbers or merchant names
  // the LLM is permitted to cite. The post-LLM validator rejects narratives
  // containing any other number >= 10 or any other merchant name.
  const quotableFacts = buildQuotableFacts(payload);
  lines.push('### QUOTABLE FACTS — the only numbers/merchants you may cite');
  lines.push('Each line is a phrase you may echo verbatim in your narrative.');
  lines.push('You may NOT cite any other number >= 10 or any other merchant name.');
  lines.push('If you want to mention a figure that is not listed here, rephrase without the figure.');
  for (const f of quotableFacts) {
    lines.push(`- "${f.text}"`);
  }
  lines.push('');

  if (selectedCapabilities && selectedCapabilities.length > 0) {
    const focuses = selectedCapabilities
      .map((id) => CAPABILITY_FOCUS[id])
      .filter(Boolean)
    if (focuses.length > 0) {
      lines.push('### User focus areas (what they said they came for)')
      lines.push('The user told us what they want from this product. Angle the insight and hook toward these goals:')
      for (const f of focuses) lines.push(`- ${f}`)
      lines.push('Do not mention these focus areas by name. Just let them shape what you emphasise and where the hook lands.')
      lines.push('')
    }
  }

  lines.push('### Patterns to narrate (in this order)');
  lines.push('For each pattern below, follow the instruction. Weave the quotable facts above into prose.');
  const layerOrder = ['headline', 'gap', 'numbers', 'hidden_pattern', 'action', 'hook'] as const;
  const seenPatternIds = new Set<string>();
  for (const layer of layerOrder) {
    const pattern = payload.layers[layer];
    if (!pattern) continue;
    // A pattern can appear in both hidden_pattern and action (for the experiment
    // frame). Narrate each pattern's observation only once.
    if (seenPatternIds.has(pattern.id) && layer === 'action') continue;
    seenPatternIds.add(pattern.id);
    lines.push('');
    lines.push(`#### ${layer.toUpperCase()}`);
    lines.push(`Pattern: ${pattern.id}`);
    lines.push(`Instruction: ${pattern.narrative_prompt}`);
  }

  // Experiment proposal — the closing beat of first insight. The system has
  // scored the catalog against the detected patterns and the user's active
  // goal. Claude proposes ONE experiment and asks via [OPTIONS]. Accept goes
  // through propose_catalog_experiment → accept_experiment.
  const proposal = payload.experiment_proposal;
  if (proposal?.primary) {
    const p = proposal.primary;
    lines.push('');
    lines.push('#### EXPERIMENT PROPOSAL (REQUIRED closing beat)');
    lines.push(`- Template id: ${p.template_id}`);
    lines.push(`- Source pattern: ${p.source_pattern_id}`);
    lines.push(`- Proposed title: ${p.title}`);
    lines.push(`- Hypothesis (paraphrase, don't quote): ${p.hypothesis}`);
    lines.push(`- Success criterion: ${p.success_criterion}`);
    lines.push(`- Duration: ${p.duration_days} day${p.duration_days === 1 ? '' : 's'}`);
    if (proposal.alternatives.length > 0) {
      const alt = proposal.alternatives.map((a) => `${a.template_id}`).join(', ');
      lines.push(`- Alternatives if user wants a different one: ${alt}`);
    }
    if (!proposal.capacity.allowed) {
      lines.push(`- CAPACITY: user already has ${proposal.capacity.activeCount}/${proposal.capacity.limit} active experiments. Mention the proposal but do NOT pressure for acceptance — finish their current experiments first.`);
    }
    lines.push('');
    lines.push('EXPERIMENT RULES:');
    lines.push('- Close the message with ONE sentence framing the proposed experiment using the title.');
    lines.push('- State the success criterion plainly.');
    lines.push('- Then emit the OPTIONS block exactly:');
    lines.push('  [OPTIONS]');
    lines.push("  - Yes, let's try it");
    lines.push('  - Pick a different one');
    lines.push('  - Not right now');
    lines.push('  [/OPTIONS]');
    lines.push('- When the user accepts: call `propose_catalog_experiment` with this template_id, then `accept_experiment`.');
    lines.push('- When the user picks a different one: present the next alternative without re-explaining the rationale.');
    lines.push('- When the user declines: do NOT push. Move on naturally.');
    lines.push('- Vocabulary: "experiment" only. Never "challenge", "task", "habit".');
    lines.push('- Never use the words "advice" or "advise" — say "suggestion", "nudge", or just what you\'d do.');
  }
  lines.push('');
  lines.push('#### STAT CARDS');
  lines.push('Emit exactly one [STATS]...[/STATS] block containing these three cards, in this order.');
  lines.push('Use this literal format (one card per line, label pipe value):');
  lines.push('[STATS]');
  for (const card of payload.statCards) {
    lines.push(`${card.label} | ${card.value}`);
  }
  lines.push('[/STATS]');
  lines.push('');
  lines.push('#### HOOK');
  lines.push(payload.hook.prompt_for_claude);
  lines.push('');
  lines.push('#### SUGGESTED RESPONSES');
  lines.push('End the message with an [OPTIONS]...[/OPTIONS] block containing exactly these three responses:');
  for (const s of payload.suggestedResponses) lines.push(`- ${s}`);
  lines.push('');
  lines.push('#### NOT AVAILABLE — do not reference');
  const planningTransform = getTransformPosture(profile) === 'planning';
  // Surface the variable-income caveat whenever the income pattern was detected
  // as variable — NOT only when posture resolved to 'planning'. Posture often
  // comes back 'unknown' (low confidence / no runway) even though income is
  // clearly variable, which previously suppressed the caveat and let the CFO
  // treat irregular income as a flat monthly salary.
  const incomeIsVariable = profile?.income_shape === 'variable';
  if (planningTransform || incomeIsVariable) {
    lines.push('- Income is VARIABLE — never call any figure "your monthly income". If t3m_income_monthly is available you may cite it as "trailing-3-month income" and note that income swings month to month.');
  } else {
    lines.push('- Income amount (even if income_detected pattern present, NEVER cite the number)');
  }
  lines.push('- Savings rate (requires income)');
  lines.push('- Surplus/deficit (requires income)');
  lines.push('- Any percentage "of income" (requires income)');
  if (!payload.userIntent) {
    lines.push('- Goals (not collected yet)');
  }
  lines.push('- Age, employment status, housing type (not collected yet)');
  lines.push('- Whether spending is "sustainable" (requires income)');
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// V2 first-insight context (Session v2.2 Chat Intelligence)
//
// Brief-first prompt. Instead of pre-narrating quotable facts, the system
// hands the LLM a thin user brief + Value Map + memory surface and tells it
// to form a hypothesis, call 1–3 detective tools, and write ONE specific
// observation. Cohort-flag-gated; v1 path remains untouched for non-cohort
// users (see `isChatIntelligenceV2Enabled`).
// ─────────────────────────────────────────────────────────────────────────────

export type BriefProfile = {
  display_name?: string | null
  country?: string | null
  primary_currency?: string | null
  net_monthly_income?: number | null
  monthly_rent?: number | null
  entry_struggle_text?: string | null
}

export type VmRowsByQuadrant = {
  foundation: string[]
  investment: string[]
  leak: string[]
  burden: string[]
  unsure: string[]
}

export type TxWindow = {
  n_transactions: number
  n_months: number
  earliest: string
  latest: string
}

type LearnedLabelRow = {
  match_value: string | null
  value_category: string | null
  confidence: number | null
  last_signal_at: string | null
  total_signals: number | null
}

function formatBriefMoney(amount: number | null | undefined, currency: string | null | undefined): string | null {
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) return null
  return formatMoney(Number(amount), currency || 'EUR')
}

function daysBetween(fromIso: string | null, toIso: string): number | null {
  if (!fromIso) return null
  const a = new Date(fromIso).getTime()
  const b = new Date(toIso).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.max(0, Math.floor((b - a) / (1000 * 60 * 60 * 24)))
}

/**
 * V2 first-insight context. Returns a multi-section prompt block joined with
 * `\n\n---\n\n`. Async because it queries `value_category_rules` for the
 * memory surface — confirmed merchant/category labels the user has
 * corrected or the system has learned.
 *
 * Selection rule for memory surface: source IN ('correction', 'learned').
 * Excludes 'value_map' because those are sample-card seeds from the 10-card
 * exercise, not user-confirmed merchant labels — surfacing them as
 * "previously confirmed" would conflate stated values with actual corrections.
 */
export async function buildFirstInsightContextV2(
  supabase: SupabaseClient,
  userId: string,
  profile: BriefProfile,
  archetype: string | null,
  valueMapTakenAt: string | null,
  vmRowsByQuadrant: VmRowsByQuadrant,
  txWindow: TxWindow,
  primaryGoal: { title: string } | null,
  experimentProposal: ExperimentProposalLayer | null,
): Promise<string> {
  const proposalPrimary = experimentProposal?.primary ?? null;
  const hasExperiment = proposalPrimary !== null;
  // ─── Memory surface query ──────────────────────────────────────────────
  let learnedLabels: LearnedLabelRow[] = []
  try {
    const { data } = await supabase
      .from('value_category_rules')
      .select('match_value, value_category, confidence, last_signal_at, total_signals')
      .eq('user_id', userId)
      .in('source', ['correction', 'learned'])
      .order('total_signals', { ascending: false })
      .limit(30)
    if (Array.isArray(data)) learnedLabels = data as LearnedLabelRow[]
  } catch (err) {
    // Don't fail the whole prompt assembly if memory query errors. The "no
    // labels yet" branch below renders cleanly.
    console.error('[context-builder-v2] memory surface query failed:', err)
    learnedLabels = []
  }

  const currency = profile.primary_currency || 'EUR'

  // ─── Section 1: The user (brief) ───────────────────────────────────────
  const userLines: string[] = ['## The user', '']
  userLines.push(`Name: ${profile.display_name || 'not yet shared'}`)
  if (profile.country) {
    userLines.push(`Country: ${profile.country} (${currency})`)
  } else {
    userLines.push(`Country: not yet shared (${currency})`)
  }
  userLines.push('Brief (in their own words):')
  userLines.push(`  Goal: "${primaryGoal?.title || 'not yet shared'}"`)
  userLines.push(`  Struggle: "${profile.entry_struggle_text || 'not yet shared'}"`)
  const incomeText = formatBriefMoney(profile.net_monthly_income, currency)
  userLines.push(`  Income: ${incomeText ? `~${incomeText} monthly` : 'not yet shared'}`)
  const rentText = formatBriefMoney(profile.monthly_rent, currency)
  userLines.push(`  Fixed costs: ${rentText ? `Rent/mortgage ~${rentText}` : 'not yet shared'}`)

  // ─── Section 2: Value Map ──────────────────────────────────────────────
  const vmLines: string[] = ['## Value Map (their stated values)', '']
  vmLines.push(`Archetype: ${archetype || 'not yet taken'}`)
  if (valueMapTakenAt) {
    const stale = daysBetween(valueMapTakenAt, new Date().toISOString())
    const datePart = valueMapTakenAt.slice(0, 10)
    vmLines.push(`Baseline taken: ${datePart} (${stale ?? 0} days ago)`)
  } else {
    vmLines.push('Baseline taken: not yet taken')
  }
  vmLines.push('Classifications:')
  vmLines.push(`  Foundation: ${vmRowsByQuadrant.foundation.join(', ') || '(none)'}`)
  vmLines.push(`  Investment: ${vmRowsByQuadrant.investment.join(', ') || '(none)'}`)
  vmLines.push(`  Leak: ${vmRowsByQuadrant.leak.join(', ') || '(none)'}`)
  vmLines.push(`  Burden: ${vmRowsByQuadrant.burden.join(', ') || '(none)'}`)
  vmLines.push(`  Unsure: ${vmRowsByQuadrant.unsure.join(', ') || '(none)'}`)
  vmLines.push('')
  vmLines.push(
    'Confidence: This is a 10-card baseline from a 5-minute exercise. Treat as',
  )
  vmLines.push(
    "the user's stated hypothesis about their values, not ground truth. The data",
  )
  vmLines.push(
    'may validate or challenge specific classifications. Surface uncertainty',
  )
  vmLines.push("when relevant — don't caveat every sentence.")

  // ─── Section 3: Data available ─────────────────────────────────────────
  const dataLines: string[] = ['## Data available', '']
  dataLines.push(`${txWindow.n_transactions} transactions across ${txWindow.n_months} months.`)
  dataLines.push(`Range: ${txWindow.earliest} to ${txWindow.latest}.`)

  // ─── Section 4: Memory surface ─────────────────────────────────────────
  const memLines: string[] = ["## What you've learned so far (memory)", '']
  if (learnedLabels.length === 0) {
    memLines.push(
      'No corrections or labels yet — this is your first real conversation with this user.',
    )
  } else {
    for (const row of learnedLabels) {
      const match = (row.match_value ?? '').trim()
      const cat = (row.value_category ?? '').trim()
      const sig = row.total_signals ?? 0
      const last = row.last_signal_at ? row.last_signal_at.slice(0, 10) : 'unknown'
      if (!match || !cat) continue
      memLines.push(`  - ${match}: ${cat} (${sig} confirmations, last: ${last})`)
    }
  }
  memLines.push('')
  memLines.push(
    'When relevant, reference these naturally ("last time you told me your',
  )
  memLines.push(
    'Tuesday Pret is Foundation — should I treat this one the same way?").',
  )
  memLines.push('Continuity is the point.')

  // ─── Section 5: How to approach the first message ──────────────────────
  const approachLines: string[] = [
    '## How to approach the first message',
    '',
    "You are writing the user's first interaction after onboarding. Goal: ONE",
    'specific, surprising, goal-relevant observation that leads cleanly into the',
    'closing beat below. Not a recap. Not a four-act narration.',
    '',
    'Steps:',
    '1. Read the brief above. Form a hypothesis about what matters most for',
    '   THIS user.',
    '2. Call 1-3 tools to test it (find_money_clusters, find_value_gaps,',
    '   find_temporal_signals, find_trend_changes, find_outliers).',
    '3. If the hypothesis holds, write the observation. If not, try another',
    "   angle. Don't narrate every tool result.",
  ]
  if (hasExperiment) {
    approachLines.push(
      '4. Close with the EXPERIMENT PROPOSAL block defined below. The proposal',
      '   IS the closing beat — do not add a separate question, action, or',
      '   labelling invitation after it.',
    )
  } else {
    approachLines.push(
      '4. End with one of: a real question, a chip-able action, or a labelling',
      '   invitation (label_transactions).',
      '',
      'When find_value_gaps returns a multi-intent shape, label_transactions is',
      'often the right move — the data is genuinely ambiguous, and asking the',
      'user resolves it AND demonstrates the system getting smarter.',
    )
  }

  // ─── Section 6: Voice rules ────────────────────────────────────────────
  const voiceLines: string[] = [
    '## Voice rules',
    '',
    'You are C. — a startup CFO speaking directly. First person. Sign off "— C."',
    '- Specific: name merchants, amounts, dates from tool output',
    '- Honest: if data is thin, say so',
    '- Direct: no "worth holding in mind", "worth knowing", "no judgement"',
    '- Curious: end with a real question, not "let me know how I can help"',
    '- Length: 100–180 words for the body. HARD CAP 180 — responses over 180 words are flagged with a server correction. Signoff on its own line.',
    '',
    'NEVER:',
    '- Compute new numbers in prose (ratios, averages, projections, annualised',
    '  savings) — those come from tools',
    '- Quote without source (every number traces to a tool call or payload field)',
    '- Use "I noticed", "great question", "advice"/"advise"',
    '- Reference the product name',
  ]

  // ─── Section 7: How to write chips ─────────────────────────────────────
  const chipLines: string[] = [
    '## How to write chips',
    '',
    'After your message, emit a [OPTIONS] block with 2-4 chips. Each chip MUST:',
    '- Reference a specific noun from your message (merchant, category, amount)',
    '- Advance the dialogue (deepen the thread, propose action, invite labelling)',
    '- NOT be a navigation jump',
    '- NOT be generic ("Tell me more" is forbidden)',
    '- NOT be a question you could answer yourself',
    '',
    'Three shapes of good chip:',
    '- Labelling: "Walk through the Friday Glovo orders"',
    '- Action: "Try cutting Glovo for 30 days"',
    '- Specificity: "Show me the Ryanair flights"',
    '',
    "If you genuinely can't think of good chips, emit none. Empty [OPTIONS] is",
    'better than fake chips.',
  ]

  // ─── Section 8: How to surface learning ────────────────────────────────
  const learningLines: string[] = [
    '## How to surface learning',
    '',
    'When a conversation changes what the system knows (labelling exchange,',
    'correction, accepted experiment), close by naming what changed and what',
    'it unlocks. Specific, quantified:',
    '',
    '  "After today, I know your Tuesday Pret is Foundation. That',
    '  auto-classifies 18 transactions going forward and changes how I read',
    '  your eating-out picture."',
    '',
    'Never use "I learned". State what\'s now true.',
  ]

  // ─── Section 9: Experiment proposal (conditional, REQUIRED closing beat) ─
  let experimentLines: string[] | null = null
  if (hasExperiment && proposalPrimary) {
    const p = proposalPrimary
    const lines: string[] = [
      '## Experiment proposal (REQUIRED closing beat)',
      '',
      `Template id: ${p.template_id}`,
      `Source pattern: ${p.source_pattern_id}`,
      `Proposed title: ${p.title}`,
      `Hypothesis (paraphrase, do not quote): ${p.hypothesis}`,
      `Success criterion: ${p.success_criterion}`,
      `Duration: ${p.duration_days} day${p.duration_days === 1 ? '' : 's'}`,
    ]
    if (experimentProposal && experimentProposal.alternatives.length > 0) {
      const alt = experimentProposal.alternatives.map((a) => a.template_id).join(', ')
      lines.push(`Alternatives if user wants a different one: ${alt}`)
    }
    if (experimentProposal && !experimentProposal.capacity.allowed) {
      lines.push(
        `CAPACITY: user already has ${experimentProposal.capacity.activeCount}/${experimentProposal.capacity.limit} active experiments. Mention the proposal but do NOT pressure for acceptance — finish current experiments first.`,
      )
    }
    lines.push('')
    lines.push('Rules:')
    lines.push('- Close the message with ONE sentence framing the proposed experiment using the title.')
    lines.push('- State the success criterion plainly.')
    lines.push('- Then emit the OPTIONS block exactly:')
    lines.push('  [OPTIONS]')
    lines.push("  - Yes, let's try it")
    lines.push('  - Pick a different one')
    lines.push('  - Not right now')
    lines.push('  [/OPTIONS]')
    lines.push('- When the user accepts: call `propose_catalog_experiment` with this template_id, then `accept_experiment`.')
    lines.push('- When the user picks a different one: present the next alternative without re-explaining the rationale.')
    lines.push('- When the user declines: do NOT push. Move on naturally.')
    lines.push('- Vocabulary: "experiment" only. Never "challenge", "task", "habit".')
    experimentLines = lines
  }

  const sections = [
    userLines.join('\n'),
    vmLines.join('\n'),
    dataLines.join('\n'),
    memLines.join('\n'),
    approachLines.join('\n'),
    voiceLines.join('\n'),
    chipLines.join('\n'),
    learningLines.join('\n'),
    experimentLines ? experimentLines.join('\n') : null,
  ].filter((s): s is string => Boolean(s))

  return sections.join('\n\n---\n\n')
}

/**
 * Build the per-quadrant friendly labels for the V2 brief from a
 * value_map_results rowset joined with SAMPLE_TRANSACTIONS. For real-data
 * Value Map runs the rows reference live transactions — falls back to the
 * merchant column when the transaction_id is not a sample-card id.
 */
export function bucketVmRowsByQuadrant(
  rows: Array<{ transaction_id: string | null; merchant: string | null; quadrant: string | null }>,
): VmRowsByQuadrant {
  const out: VmRowsByQuadrant = {
    foundation: [],
    investment: [],
    leak: [],
    burden: [],
    unsure: [],
  }
  const sampleById = new Map(SAMPLE_TRANSACTIONS.map((t) => [t.id, t.description]))
  for (const row of rows) {
    const q = (row.quadrant ?? '').toLowerCase()
    const txId = row.transaction_id ?? ''
    const friendly = sampleById.get(txId) ?? row.merchant ?? null
    if (!friendly) continue
    if (q === 'foundation' || q === 'investment' || q === 'leak' || q === 'burden') {
      out[q].push(friendly)
    } else {
      // 'unsure', null, or anything else → unsure bucket
      out.unsure.push(friendly)
    }
  }
  return out
}

async function buildValueMapBridgeContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: any,
  conversationId: string | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<string> {
  if (!profile) return ''
  if (profile.onboarding_route !== 'chat') return ''
  if (profile.value_map_declined_in_chat) return ''
  const step = profile.onboarding_step as string | null
  if (
    step === 'value_map_done' ||
    step === 'upload_done' ||
    step === 'archetype_shown' ||
    step === 'complete'
  ) {
    return ''
  }

  const lines: string[] = [
    '## VALUE MAP BRIDGE',
    "Once you have gathered enough context about the user's situation (typically after a few exchanges where they have shared meaningful context about their goal/struggle), suggest the Value Map. Frame it as connecting their stated goal/struggle to their day-to-day spending — that's where the gap usually shows up.",
    '',
    'Examples of framing — all three name the activity using the same core phrase so the offer feels consistent across struggles:',
    "- For wealth-building: \"Building toward [their goal] means looking at how money moves day-to-day. We want to look at your transactions, through our unique Value Map activity — it's how the gap between intent and reality becomes visible.\"",
    "- For debt clearing: \"Clearing this faster comes down to where surplus can come from. We want to look at your transactions, through our unique Value Map activity — it's how we find what's actually movable.\"",
    "- For planning: \"To get to [their goal] you need a clear picture of where each month is going. We want to look at your transactions, through our unique Value Map activity — it's where the picture sharpens.\"",
    '',
    'When you decide to offer it, include this token verbatim somewhere in your response: <ACTION:start_value_map>',
    'Do not describe the token to the user; the system will render an action button for them.',
    'If the user declines ("not now", "later", "skip"), do NOT bring up the Value Map again proactively in this conversation. Acknowledge their decision and continue helping them with what they came to discuss.',
  ]

  // Backstop: if conversation has reached threshold and offer hasn't fired, push for it now.
  if (conversationId && !profile.value_map_offered_in_chat) {
    try {
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversationId)
        .eq('role', 'user')
      if ((count ?? 0) >= BRIDGE_USER_MSG_THRESHOLD) {
        lines.push(
          '',
          '## BRIDGE BACKSTOP',
          'This conversation has reached the point where you should offer the Value Map. Do it in your next response with appropriate framing per the BRIDGE guidance above. Include <ACTION:start_value_map> in your response.',
        )
      }
    } catch (err) {
      console.error('[bridge-context] message count failed', err)
    }
  }

  return lines.join('\n')
}

function buildOnboardingEntryContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: any,
): string {
  if (!profile) return ''
  if (profile.onboarding_route !== 'chat') return ''
  const struggle = profile.entry_struggle as string | null
  if (!struggle) return ''

  const labels: Record<string, string> = {
    dont_know: "I don't know where my money goes",
    debt:      "I'm carrying debt I want to clear",
    wealth:    'I want to start building wealth',
    planning:  "I'm planning for something specific",
    free_text: '(In their own words — see entry_struggle_text)',
  }
  const struggleLabel = labels[struggle] ?? struggle
  const text = (profile.entry_struggle_text as string | null) || null

  const lines = [
    '## USER ENTRY CONTEXT',
    `- Stated struggle: ${struggleLabel}`,
  ]
  if (text) {
    lines.push(`- In their own words: "${text}"`)
  }
  lines.push(
    '- They have not yet completed the Value Map or shared transactions.',
    '',
    '## GUIDANCE',
    '- No transaction data, no Value Map results, no income context yet.',
    '- Acknowledge the stated struggle specifically (no generic "Got it") and surface one observation before asking anything. Answer first, ask second.',
    '- Maximum one clarifying question per turn. Anchor it to what they already said, not a checklist.',
    '- Do not assume their income, country, family situation, or risk tolerance.',
    '- The remit still applies: observe, calculate, educate. Never recommend specific products or make buy/sell calls. Never use the words "advice" or "advise".',
  )
  return lines.join('\n')
}

function buildGoalDeriveConfirmContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  goals: any[] | null,
): string {
  const struggle = (profile?.entry_struggle ?? null) as string | null
  const struggleText = (profile?.entry_struggle_text ?? null) as string | null

  const hasGoal = Array.isArray(goals) && goals.length > 0
  const onboardingStep = (profile?.onboarding_step ?? null) as string | null

  // Value-first flow: the goal beat is goal-only. Income and rent are
  // collected later on the processing screen. Once a goal is confirmed
  // (or the tentative-stall path runs out), the GoalBeatWatcher polls
  // /api/onboarding/essentials-status, sees goal=true, and routes to
  // /onboarding-v2/upload. Emit a brief, single-shot hand-off so the
  // CFO doesn't try to collect income/rent here.
  if (hasGoal || onboardingStep === 'goal_chat_tentative') {
    return [
      '## Wrap-up',
      '',
      hasGoal
        ? 'You have their goal. The next move is their transactions — the system is about to route them to the upload screen.'
        : 'The user is taking a moment to decide on a goal. That is fine — say so briefly. The next move is their transactions; the system will route them to upload.',
      '',
      'In one short message (2–3 sentences):',
      '- Acknowledge what you have (or that a goal can wait).',
      '- Say you are about to look at their numbers so the picture gets specific.',
      '',
      'Do NOT call any tools. Do NOT ask for income, rent, or any other number — those are collected on the next screen, not here. Do NOT ask another question. Do NOT tell the user to upload anything or that there is an upload button here — the system moves them to the upload screen automatically.',
    ].join('\n')
  }

  const struggleSummary = (() => {
    if (struggle === 'dont_know') {
      return "The user said: \"I don't know where my money goes.\""
    }
    if (struggle === 'debt') return "The user said: \"I'm carrying debt I want to clear.\""
    if (struggle === 'wealth') return "The user said: \"I want to start building wealth.\""
    if (struggle === 'planning') return "The user said: \"I'm planning for something specific.\""
    if (struggle === 'free_text' && struggleText) return `The user said, in their own words: "${struggleText}"`
    return 'The user has not yet articulated a struggle.'
  })()

  const lines = [
    '## Your task in this conversation',
    '',
    'The user has just walked into your office for the first time. They have shared one signal — what brought them in today.',
    '',
    struggleSummary,
    '',
    'Your job in this conversation is one thing: turn that signal into a concrete goal you can both work toward — a name, a target amount, a target date, and a starting point. You do this by drafting a goal and confirming it with them, not by asking a list of questions.',
    '',
    '### How to derive',
    '',
    "1. **Draft from what you have.** If the struggle gives you enough to draft a specific target (e.g. they said 'I've got about £4k on my card'), draft directly: name the goal, propose a target amount, propose a target date, and present it as a single concrete proposal.",
    "2. **Ask one clarifying question if you must.** If the signal is too vague to draft (e.g. 'planning for something specific' with no detail, or 'I don't know where my money goes' with no direction), ask exactly one question to turn the direction into a target. One question per turn — never a list.",
    '3. **Confirm.** Present the draft and ask whether the target is right. The user will either accept or correct.',
    '4. **Honour corrections to the letter.** If the user corrects ("no, more like £5k by summer"), the user\'s exact terms are authoritative — re-draft to match, do not average or round.',
    '',
    '### Goal draft rule (REQUIRED)',
    '',
    'Once the user has named EITHER:',
    '- an amount (any sum reference: "£15k", "around $20,000", "the card debt"), OR',
    '- a target window ("3-5 years", "by 2028", "in a couple of years")',
    '',
    'you MUST emit a goal draft in your NEXT response. Use this exact shape:',
    '',
    '> **[Goal title]** — [amount in user\'s currency] by [target date].',
    '> If that looks right, confirm and it\'s set.',
    '',
    'If both amount AND window are given, draft immediately. If only one is given, ask ONE follow-up question for the missing piece, then draft on the next turn. You MUST NOT ask more than 2 clarifying questions before drafting. Drafting is the forcing function — an imperfect goal that gets refined beats perfect data-gathering forever.',
    '',
    '### Seeding the starting amount',
    '',
    'You do not yet have access to the user\'s statements at this point — they have not been uploaded. To seed the starting amount, you must ask. For a debt-clearing goal: "what\'s on the card today?". For a savings goal: "what have you put away so far?". The user\'s answer is the starting point.',
    '',
    'Frame the starting amount honestly: it is the starting point, and from here progress is tracked through contributions the user logs as they go. That mechanism arrives shortly — for now, anchor on a true starting number.',
    '',
    '### When to call create_goal',
    '',
    'Call `create_goal` only after the user confirms a target you have presented. Pass:',
    '- `name`: a short user-recognisable name (use the user\'s own term where possible — "the credit card", "Japan", "the deposit")',
    '- `target_amount`: the number the user confirmed',
    '- `target_date`: the date the user confirmed (must be in the future, YYYY-MM-DD)',
    '- `current_amount`: the starting amount the user told you',
    '- `description`: a short clarifying sentence if useful',
    '',
    'Do not call `create_goal` speculatively. One goal per onboarding.',
    '',
    "### When the user can't articulate a goal",
    '',
    "If the user truly cannot articulate a target after one clarifying question (most likely with `dont_know`), do not force one. Acknowledge briefly — e.g. \"That's fine — let's get visibility first, then come back to this once we can see your money moving.\" — and stop. Do NOT ask for any numbers; do NOT call request_structured_input. The system will route the user to the upload screen on its own; your job here is just to acknowledge and stop. There is NO upload control on this screen: never tell the user to upload anything here, to drag in a statement, or that an upload button is below the chat — the system takes them to the upload screen automatically.",
    '',
    '### After create_goal succeeds',
    '',
    "Confirm the goal in one line and stop. Do NOT in the same message push the user to upload a statement and do NOT ask for any other number — income, rent, and other fixed costs are collected on the next screen, not here. The system will route the user onward once the goal lands.",
  ]

  return lines.join('\n')
}

/**
 * Why-beat — the CFO's first live conversational move after the delta recompose
 * hands off into chat. A read-and-confirm about the single most significant
 * AMBIGUOUS merchant: offer a plausible interpretation of what it's FOR in the
 * user's life and invite correction. Never "why do you spend on X"; never frame
 * spend as a problem to defend. Offered once; the reply is captured by the
 * existing Layer-4 chat_signals extractor.
 *
 * Gated to the value-first first_read thread, after the recompose has been
 * delivered, before why_beat_offered is set. Returns '' when not applicable.
 *
 * Exported so the framing-rule text can be asserted in tests.
 */
export function renderWhyBeatBlock(m: SignificantMerchant): string {
  const conf =
    m.userConfidence != null
      ? `they sorted it at confidence ${m.userConfidence}/5`
      : `they didn't sort it`;
  const shape = m.likelyDivergence
    ? `its behavioural shape doesn't match how it's usually treated`
    : `it's high behavioural salience and worth understanding`;
  return [
    `## OPENING MOVE — read-and-confirm (use at most once, on an early turn)`,
    ``,
    `There is one merchant worth understanding before anything else: ${m.displayName} (${shape}; ${conf}).`,
    ``,
    `Offer a READ and invite correction. Propose a plausible, specific interpretation of what`,
    `this merchant is FOR in their life, then let them confirm or refine it. You are allowed to`,
    `be slightly wrong in an interesting way — people engage by correcting a read of themselves.`,
    ``,
    `  GOOD: "${m.displayName} looks like the thing you reach for when the day's already gotten`,
    `         away from you — fair, or is it something else?"`,
    `  BANNED: "Why do you spend so much on ${m.displayName}?" or any phrasing that asks them to`,
    `         JUSTIFY a spend. The judgement comes from demanding an account; the resonance comes`,
    `         from offering a read.`,
    ``,
    `Do this ONCE. If they engage, follow their lead. If they deflect or ignore it, drop it — do`,
    `not re-ask, do not push. Never frame their spending as a problem to defend. Weave it in`,
    `naturally; if the user just tapped a directive, address that first, then offer the read.`,
  ].join('\n');
}

export async function buildWhyBeatContext(
  userId: string,
  conversationType?: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conversationMetadata?: Record<string, any> | null,
): Promise<string> {
  if (!isLayeredReadEnabled()) return '';
  if (conversationType !== 'first_read') return '';
  // The recompose must have been delivered, and the beat not yet offered.
  if (!conversationMetadata?.first_read_metadata_recomposed) return '';
  if (conversationMetadata?.why_beat_offered) return '';

  try {
    const svc = createServiceClient();
    const merchant = await pickSignificantAmbiguousMerchant(svc, userId);
    if (!merchant) return '';
    return renderWhyBeatBlock(merchant);
  } catch (err) {
    console.error('[why-beat] context build failed:', err);
    return '';
  }
}

export async function buildSystemPrompt(
  userId: string,
  conversationType?: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conversationMetadata?: Record<string, any> | null,
  conversationId?: string | null
): Promise<string> {
  const supabase = await createClient();

  // Query all data sources in parallel
  const [
    profileResult,
    snapshotsResult,
    recurringResult,
    portraitResult,
    valueMapResult,
    goalsResult,
    actionsResult,
    tripsResult,
    assetsResult,
    liabilitiesResult,
    primaryGoalResult,
  ] = await Promise.allSettled([
    supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single(),
    supabase
      .from('monthly_snapshots')
      .select('*')
      .eq('user_id', userId)
      .order('month', { ascending: false })
      .limit(6),
    supabase
      .from('recurring_expenses')
      .select('*')
      .eq('user_id', userId),
    supabase
      .from('financial_portrait')
      .select('*')
      .eq('user_id', userId)
      .is('dismissed_at', null)
      .order('confidence', { ascending: false }),
    supabase
      .from('value_map_sessions')
      .select('*')
      .eq('profile_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from('goals')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active'),
    supabase
      .from('action_items')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'pending'),
    supabase
      .from('events')
      .select('id, name, destination, kind, start_date, end_date, total_estimated, status, currency, updated_at')
      .eq('user_id', userId)
      .in('status', ['planning', 'booked'])
      .is('deleted_at', null)
      .order('start_date', { ascending: true }),
    supabase
      .from('assets')
      .select('*')
      .eq('user_id', userId)
      .order('asset_type', { ascending: true })
      .order('current_value', { ascending: false, nullsFirst: false }),
    supabase
      .from('liabilities')
      .select('*')
      .eq('user_id', userId)
      .order('interest_rate', { ascending: false, nullsFirst: false }),
    // Centralised "does this user have a goal" signal (Session 11). Reused
    // here so the chat path and home surface cannot drift on the active-goal
    // definition (status='active' AND deleted_at IS NULL, primary sort).
    // A rejected promise (Postgres error) falls through to null via the
    // destructure below — the no-goal marker is the safe default.
    getPrimaryGoal(supabase, userId),
  ]);

  const profile = profileResult.status === 'fulfilled' ? profileResult.value.data : null;
  const snapshots = snapshotsResult.status === 'fulfilled' ? snapshotsResult.value.data : null;
  const recurring = recurringResult.status === 'fulfilled' ? recurringResult.value.data : null;
  const portrait = portraitResult.status === 'fulfilled' ? portraitResult.value.data : null;
  const valueMap = valueMapResult.status === 'fulfilled' ? valueMapResult.value.data : null;
  const goals = goalsResult.status === 'fulfilled' ? goalsResult.value.data : null;
  const actions = actionsResult.status === 'fulfilled' ? actionsResult.value.data : null;
  const trips = tripsResult.status === 'fulfilled' ? tripsResult.value.data : null;
  // Defensive read-side dedup: collapse rows with the same destination+month, keep most recent.
  // Protects against any legacy duplicates created before plan_event's UPSERT path landed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dedupedTrips: any[] | null = (() => {
    if (!trips) return trips;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byKey = new Map<string, any>();
    for (const t of trips) {
      const dest = (t.destination ?? t.name ?? '').trim().toLowerCase();
      const month = t.start_date ? t.start_date.slice(0, 7) : 'no-date';
      const key = `${dest}|${month}`;
      const existing = byKey.get(key);
      if (!existing || (t.updated_at && existing.updated_at && t.updated_at > existing.updated_at)) {
        byKey.set(key, t);
      }
    }
    return Array.from(byKey.values()).slice(0, 3);
  })();
  const assets = assetsResult.status === 'fulfilled' ? assetsResult.value.data : null;
  const liabilities = liabilitiesResult.status === 'fulfilled' ? liabilitiesResult.value.data : null;
  // getPrimaryGoal returns PrimaryGoal | null directly (not { data, error }).
  // A REJECTED promise (transient Postgres error) must NOT be reported to the
  // CFO as "no active goal" — that made the CFO contradict itself mid-read
  // ("On your goal…" then "No active goal recorded yet"). We distinguish
  // unavailable from genuinely-none and let buildGoalsContext fall back to the
  // multi-goal fetch (`goals`) when it succeeded.
  const primaryGoal: PrimaryGoal | null =
    primaryGoalResult.status === 'fulfilled' ? primaryGoalResult.value : null;
  const primaryGoalUnavailable = primaryGoalResult.status === 'rejected';

  // Voice register (Constitution v1.1 §2). The underlying finding never changes
  // between registers — only the phrasing around it. Gentle is warmer phrasing,
  // not softening the finding itself.
  const adviceStyle = profile?.advice_style || 'direct';
  let styleModifier = '';
  if (adviceStyle === 'blunt') {
    styleModifier = '\n\nRegister: blunt. Strip qualifiers. The underlying finding is unchanged; the phrasing is leaner. Never harsh, never insulting — leaner.';
  } else if (adviceStyle === 'gentle') {
    styleModifier = '\n\nRegister: gentle. Warmer phrasing around the same finding. Never softens the finding itself. Never flatters. "You\'re doing great" is forbidden in all registers.';
  } else {
    styleModifier = '\n\nRegister: direct. Short declarative sentences. Specifics over generalities. No hedging, no apologising for delivering hard truths.';
  }

  // Goal-derive-and-confirm mode: the new beat between the struggle picker and
  // the next step. The system prompt is restricted to persona + voice, lean
  // profile, and the derive-and-confirm task — no portrait, no goals context
  // (none exist yet), no value-map context, no benchmarks. Keeps the CFO
  // focused on one job: turn entry_struggle into a concrete confirmed goal.
  //
  // No posture fragment here. Posture-aware modulation is for users who have
  // ingested ≥2 months of data — i.e. past onboarding. Layering the surviving
  // fragment's "no forward planning beyond 30 days" over the goal-derive task
  // produces an LLM that hedges goal commit (agrees to the goal concept but
  // defers the amount), which leaves onboarding_step stuck at goal_chat_started.
  const isGoalDeriveConfirm = conversationType === 'onboarding_goal_chat';
  if (isGoalDeriveConfirm) {
    const sections = [
      BASE_PERSONA + styleModifier,
      buildCurrentDateContext(),
      buildProfileContext(profile),
      buildGoalDeriveConfirmContext(profile, goals),
      buildToolUsageInstructions(),
    ].filter(Boolean);

    return sections.join('\n\n---\n\n');
  }

  // First Insight mode: when a first_insight_payload is attached, the system
  // has deterministically computed everything Claude is allowed to say. We
  // suppress any section that would leak income, surplus, goals, portrait
  // traits, benchmarks, etc. — the payload is the sole source of truth.
  //
  // V2 (Session v2.2 Chat Intelligence) cohort users take a different
  // branch: brief + tools + memory surface instead of pre-computed
  // narration. Gated by isChatIntelligenceV2Enabled(profile). The v2 path
  // does NOT require first_insight_payload to be present — the LLM forms
  // its hypothesis from the brief and pulls numbers via the 10 tools.
  const firstInsightPayload = conversationMetadata?.first_insight_payload as InsightPayload | undefined;
  const conversationIsFirstInsight =
    conversationType === 'first_read' || conversationType === 'post_upload';
  const v2Enabled = isChatIntelligenceV2Enabled(profile);

  if (conversationIsFirstInsight && v2Enabled) {
    // V2 brief assembly. Fetch the extras the brief needs (value_map_results
    // for per-quadrant labels, transaction window stats). Done sequentially
    // after the parallel block so the v1 path is unaffected.
    // entry_struggle_text exists at runtime but the typed schema may lag —
    // cast through unknown to silence the per-key strict access.
    const profileRecord = (profile ?? {}) as Record<string, unknown>;
    const briefProfile: BriefProfile = {
      display_name: (profileRecord.display_name as string | null) ?? null,
      country: (profileRecord.country as string | null) ?? null,
      primary_currency: (profileRecord.primary_currency as string | null) ?? null,
      net_monthly_income: (profileRecord.net_monthly_income as number | null) ?? null,
      monthly_rent: (profileRecord.monthly_rent as number | null) ?? null,
      entry_struggle_text: (profileRecord.entry_struggle_text as string | null) ?? null,
    };

    const archetype =
      (valueMap?.archetype_name as string | null) ??
      (valueMap?.personality_type
        ? (PERSONALITIES[valueMap.personality_type]?.name ?? (valueMap.personality_type as string))
        : null);

    let vmRowsByQuadrant: VmRowsByQuadrant = {
      foundation: [],
      investment: [],
      leak: [],
      burden: [],
      unsure: [],
    };
    let valueMapTakenAt: string | null = null;
    if (valueMap?.id) {
      const { data: vmRows } = await supabase
        .from('value_map_results')
        .select('transaction_id, merchant, quadrant, created_at')
        .eq('session_id', valueMap.id)
        .order('created_at', { ascending: true });
      if (Array.isArray(vmRows) && vmRows.length > 0) {
        vmRowsByQuadrant = bucketVmRowsByQuadrant(vmRows);
        valueMapTakenAt = (vmRows[0]?.created_at as string | null) ?? null;
      }
    }

    // Transaction window: count + min/max date in a single query each.
    let txWindow: TxWindow = {
      n_transactions: 0,
      n_months: 0,
      earliest: 'unknown',
      latest: 'unknown',
    };
    try {
      const [{ count: txCount }, { data: minRow }, { data: maxRow }] = await Promise.all([
        supabase
          .from('transactions')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId),
        supabase
          .from('transactions')
          .select('date')
          .eq('user_id', userId)
          .order('date', { ascending: true })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('transactions')
          .select('date')
          .eq('user_id', userId)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      const earliest = (minRow?.date as string | null) ?? null;
      const latest = (maxRow?.date as string | null) ?? null;
      const months = earliest && latest
        ? Math.max(1, Math.round(
            (new Date(latest).getTime() - new Date(earliest).getTime()) /
              (1000 * 60 * 60 * 24 * 30),
          ))
        : 0;
      txWindow = {
        n_transactions: txCount ?? 0,
        n_months: months,
        earliest: earliest ?? 'unknown',
        latest: latest ?? 'unknown',
      };
    } catch (err) {
      console.error('[context-builder-v2] tx window query failed:', err);
    }

    const primaryGoalBrief = primaryGoal ? { title: primaryGoal.name } : null;

    const experimentProposal =
      (conversationMetadata?.experiment_proposal as ExperimentProposalLayer | null | undefined) ?? null;

    const sections = [
      BASE_PERSONA + styleModifier,
      buildCurrentDateContext(),
      await buildFirstInsightContextV2(
        supabase,
        userId,
        briefProfile,
        archetype,
        valueMapTakenAt,
        vmRowsByQuadrant,
        txWindow,
        primaryGoalBrief,
        experimentProposal,
      ),
      await getConversationInstructions(conversationType, conversationMetadata, userId, snapshots, profile),
      // Why-beat — the read-and-confirm opener after the delta recompose hands
      // off. Empty unless this is a delivered-recompose first_read thread with a
      // significant ambiguous merchant and the beat not yet offered.
      await buildWhyBeatContext(userId, conversationType, conversationMetadata),
      buildToolUsageInstructions(),
      getPosturePromptFragment(profile),
    ].filter(Boolean);

    return sections.join('\n\n---\n\n');
  }

  if (conversationIsFirstInsight && firstInsightPayload) {
    const sections = [
      BASE_PERSONA + styleModifier,
      buildCurrentDateContext(),
      buildFirstInsightContext(firstInsightPayload, undefined, profile),
      await getConversationInstructions(conversationType, conversationMetadata, userId, snapshots, profile),
      buildToolUsageInstructions(),
      getPosturePromptFragment(profile),
    ].filter(Boolean);

    return sections.join('\n\n---\n\n');
  }

  // The nine section builders below are independent reads (verified read-only,
  // no cross-section data dependencies), so fan them out in parallel before
  // assembling the prompt. The previous sequential await chain added 200–500ms
  // of avoidable serialisation per turn.
  const [
    bridgeContext,
    countryBenchmarks,
    conversationInstructions,
    experimentContext,
    valueMappingContext,
    valueCheckinNudge,
    retakeSuggestion,
    predictionQuality,
    profilingContext,
    openItemsBlock,
  ] = await Promise.all([
    buildValueMapBridgeContext(profile, conversationId ?? undefined, supabase),
    getCountryBenchmarks(profile, supabase),
    getConversationInstructions(conversationType, conversationMetadata, userId, snapshots, profile),
    buildExperimentContext(supabase, userId),
    getValueMappingContext(userId, supabase),
    getValueCheckinNudgeContext(userId, supabase, conversationType),
    getRetakeSuggestionContext(userId, supabase, conversationType),
    getPredictionQualityContext(userId, supabase),
    buildProfilingContext(userId, supabase),
    // Open-items resumption context — only for `general` conversations.
    // Other branches (first_read, onboarding, monthly_review, etc.) have
    // their own dedicated scaffolds and shouldn't be diluted.
    conversationType === 'general' || !conversationType
      ? getOpenItems(supabase, userId).then(renderOpenItemsBlock).catch((err) => {
          console.error('[context-builder] open-items load failed', err);
          return '';
        })
      : Promise.resolve(''),
  ]);

  const sections = [
    BASE_PERSONA + styleModifier,
    buildCurrentDateContext(),
    buildProfileContext(profile),
    buildOnboardingEntryContext(profile),
    bridgeContext,
    buildFinancialContext(snapshots, recurring, profile),
    buildPostureContext(profile, recurring),
    countryBenchmarks,
    conversationInstructions,
    buildPortraitContext(portrait, valueMap),
    buildBalanceSheetContext(assets, liabilities),
    buildGoalsContext(goals, actions, primaryGoal, primaryGoalUnavailable),
    openItemsBlock,
    buildTripsContext(dedupedTrips, profile),
    experimentContext,
    buildToolUsageInstructions(),
    isLayeredReadEnabled() ? buildLayeredReadInstructions() : '',
    valueMappingContext,
    valueCheckinNudge,
    retakeSuggestion,
    predictionQuality,
    profilingContext,
    getPosturePromptFragment(profile),
  ].filter(Boolean);

  return sections.join('\n\n---\n\n');
}

// Session 32 (A) — Layered Read instructions. Gated by isLayeredReadEnabled().
// Active on deploys of session-32/the-read and local with LAYERED_READ_LOCAL_OVERRIDE=true.
// Strengthened in Session 32 (B) to make tool invocation mandatory rather than advisory.
// Removed in Session D when the layered model becomes default.
function buildLayeredReadInstructions(): string {
  return [
    '## Behavioural features and prior conversation',
    '',
    'You have access to two tools that surface the user\'s actual behavioural patterns:',
    '',
    '- `get_cluster_behaviour(cluster_type, cluster_id, window_days?)` — returns five features for a merchant or category cluster:',
    '  - recurrence (pattern_label: daily/weekly/monthly/irregular/sparse, with median interval and regularity)',
    '  - trend (direction: climbing/declining/stable/volatile, with slope_percent_per_month)',
    '  - time_pattern (weekday share, dominant day of week)',
    '  - amount_profile (mean, stddev, consistency_label: fixed/tight/variable/wide)',
    '  - lifecycle (status: new/active/dormant/returning, with first_seen and days_since_last)',
    '- `get_conversation_signals(target_merchant?, target_category?, signal_types?, limit?)` — returns signals (regret, enjoyment, context_person, context_event, context_situation) extracted from prior chat.',
    '',
    'WHEN TO CALL `get_cluster_behaviour` (MANDATORY):',
    '',
    'You MUST call `get_cluster_behaviour` before responding whenever the user asks about, or you are about to discuss:',
    '- A specific merchant (e.g. "what does my Pret spend look like?", "I\'ve been at Pollo Tropical a lot")',
    '- A specific category (e.g. "how\'s my dining spending?", "am I overdoing it on transport?")',
    '- A pattern, trend, or change in spending behaviour ("is this getting worse?", "am I spending more lately?")',
    '',
    // eslint-disable-next-line no-restricted-syntax -- "#142" is a merchant-code example in prose, not a colour
    'Pass the cluster_id as a brand name the user would say — `"Pollo Tropical"`, `"Pret"`, `"Starbucks"`. The tool resolves substring matches and rolls up brand variants (`#142`, ` DRIVE THRU`, location codes) into one cluster. Do NOT pass the raw description (`"POS PURCHASE POLLO TROPICAL #142"`) — pass the clean brand.',
    '',
    'AFTER the tool returns, you MUST cite at least two specific features in your reply. Examples of good citation:',
    '- "13 visits in 90 days, climbing 18% a month, mostly weekday mornings — mean £4.65."',
    '- "First hit in April, every 6 days like clockwork, mean £8.40."',
    '- "Three months in, the trend is flat but the day-of-week pattern shifted from weekday lunches to weekend dinners."',
    '',
    'Never name a merchant or assert a pattern without specific features behind it. If the tool returns thin data (data_completeness < 0.4), say so honestly: "I\'ve only got a few weeks on this one — early signal."',
    '',
    'WHEN TO CALL `get_conversation_signals`:',
    '',
    'Call this when the user references regret, enjoyment, social context, or "I should/shouldn\'t" framing, OR when you want to check what they\'ve previously said about a merchant or category before commenting on it.',
    '',
    'STYLE:',
    '',
    'Never use internal labels in your reply — no "verdict", no "joy signal", no "Layer 3", no "the Gap" as a feature name. Speak in plain language about what you observe.',
    '',
    'When the user\'s Value Map states an intent (e.g. "dining is a Leak") and the behavioural trend conflicts (e.g. dining climbing), point out the divergence factually and ask the user what\'s changing. This is the only place "the Gap" concept survives — as a move you make in conversation, not a feature name.',
  ].join('\n');
}

function buildCurrentDateContext(): string {
  const now = new Date();
  const iso = now.toISOString().slice(0, 10);
  const formatted = now.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  return [
    '## Current date',
    `Today is ${formatted} (${iso}).`,
    '',
    'When the user mentions a month, season, or quarter without a year, do NOT assume the current year. Ask which year they mean — unless the user has already named the year, the date sits clearly in the future, or the conversation context makes it unambiguous. Never silently default to "the next upcoming May".',
  ].join('\n');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildProfileContext(profile: any): string {
  if (!profile) return '';

  const fields: string[] = [];

  if (profile.display_name) fields.push(`Name: ${profile.display_name}`);
  if (profile.country) fields.push(`Country: ${profile.country}`);
  if (profile.city) fields.push(`City: ${profile.city}`);
  if (profile.primary_currency) fields.push(`Currency: ${profile.primary_currency}`);
  if (profile.age_range) fields.push(`Age range: ${profile.age_range}`);
  if (profile.employment_status) fields.push(`Employment: ${profile.employment_status}`);
  if (profile.net_monthly_income) fields.push(`Net monthly income: ${profile.primary_currency || 'EUR'} ${profile.net_monthly_income}`);
  if (profile.gross_salary) fields.push(`Gross salary: ${profile.primary_currency || 'EUR'} ${profile.gross_salary}`);
  if (profile.pay_frequency) fields.push(`Pay frequency: ${profile.pay_frequency}`);
  if (profile.has_bonus_months && profile.bonus_month_details) fields.push(`Bonus months: ${JSON.stringify(profile.bonus_month_details)}`);
  if (profile.housing_type) fields.push(`Housing: ${profile.housing_type}`);
  if (profile.monthly_rent) fields.push(`Monthly rent/mortgage: ${profile.primary_currency || 'EUR'} ${profile.monthly_rent}`);
  if (profile.relationship_status) fields.push(`Relationship: ${profile.relationship_status}`);
  if (profile.partner_employment_status) fields.push(`Partner employment: ${profile.partner_employment_status}`);
  if (profile.partner_monthly_contribution) fields.push(`Partner contribution: ${profile.primary_currency || 'EUR'} ${profile.partner_monthly_contribution}/month`);
  if (profile.dependents) fields.push(`Dependents: ${profile.dependents}`);
  if (profile.nationality) fields.push(`Nationality: ${profile.nationality}`);
  if (profile.risk_tolerance) fields.push(`Risk tolerance: ${profile.risk_tolerance}`);
  if (profile.values_ranking) fields.push(`Values ranking: ${JSON.stringify(profile.values_ranking)}`);
  if (profile.financial_awareness) fields.push(`Financial awareness: ${profile.financial_awareness}`);
  if (profile.spending_triggers) fields.push(`Spending triggers: ${JSON.stringify(profile.spending_triggers)}`);
  if (profile.residency_status) fields.push(`Residency status: ${profile.residency_status}`);
  if (profile.tax_residency_country) fields.push(`Tax residency: ${profile.tax_residency_country}`);
  if (profile.years_in_country) fields.push(`Years in country: ${profile.years_in_country}`);
  if (profile.beta_cohort && COHORT_LABEL[profile.beta_cohort]) {
    fields.push(`Cohort: ${COHORT_LABEL[profile.beta_cohort]} beta tester`);
  }

  if (fields.length === 0) return '';

  const completeness = profile.profile_completeness || 0;
  const completenessNote = `\nProfile completeness: ${completeness}%.`;

  // Build an explicit "already known" list so the LLM never re-asks for populated fields
  const knownFieldLabels: string[] = [];
  if (profile.display_name) knownFieldLabels.push('name');
  if (profile.country) knownFieldLabels.push('country');
  if (profile.city) knownFieldLabels.push('city');
  if (profile.primary_currency) knownFieldLabels.push('currency');
  if (profile.age_range) knownFieldLabels.push('age');
  if (profile.employment_status) knownFieldLabels.push('employment status');
  if (profile.net_monthly_income) knownFieldLabels.push('monthly take-home pay');
  if (profile.gross_salary) knownFieldLabels.push('gross salary');
  if (profile.pay_frequency) knownFieldLabels.push('pay frequency');
  if (profile.has_bonus_months) knownFieldLabels.push('bonus months');
  if (profile.housing_type) knownFieldLabels.push('housing type');
  if (profile.monthly_rent) knownFieldLabels.push('rent/mortgage amount');
  if (profile.relationship_status) knownFieldLabels.push('relationship status');
  if (profile.partner_employment_status) knownFieldLabels.push('partner employment');
  if (profile.partner_monthly_contribution) knownFieldLabels.push('partner contribution');
  if (profile.dependents) knownFieldLabels.push('dependents');
  if (profile.nationality) knownFieldLabels.push('nationality');
  if (profile.risk_tolerance) knownFieldLabels.push('risk tolerance');
  if (profile.advice_style) knownFieldLabels.push('advice style');
  if (profile.spending_triggers) knownFieldLabels.push('spending triggers');
  if (profile.values_ranking) knownFieldLabels.push('values ranking');
  if (profile.financial_awareness) knownFieldLabels.push('financial awareness');
  if (profile.residency_status) knownFieldLabels.push('residency status');
  if (profile.tax_residency_country) knownFieldLabels.push('tax residency country');
  if (profile.years_in_country) knownFieldLabels.push('years in country');

  let doNotAskBlock = '';
  if (knownFieldLabels.length > 0) {
    doNotAskBlock = `\n\nCRITICAL — You already have: ${knownFieldLabels.join(', ')}. DO NOT ask for any of these again. Use the values above directly. If the user volunteers an update, accept it — but never re-ask.`;
  }

  // Psychological lens — make values_ranking, financial_awareness, and
  // spending_triggers load-bearing rather than background metadata.
  // Pre-value-first these columns were being written by the profile form
  // + chat structured input but never used as a lens for interpretation;
  // the lines above injected them as flat facts. This block tells the
  // model what to do with them.
  const lensFields: string[] = [];
  if (profile.values_ranking) {
    lensFields.push(`- Stated values ranking: ${JSON.stringify(profile.values_ranking)}`);
  }
  if (profile.financial_awareness) {
    lensFields.push(`- Financial awareness: ${profile.financial_awareness}`);
  }
  if (profile.spending_triggers) {
    lensFields.push(`- Stated spending triggers: ${JSON.stringify(profile.spending_triggers)}`);
  }
  let lensBlock = '';
  if (lensFields.length > 0) {
    lensBlock = [
      '',
      '',
      '## Psychological lens (interpretive aid, not chit-chat)',
      '',
      'Use these the user has shared in earlier conversations to interpret behaviour. Do NOT recite them; let them shape how you read patterns.',
      '',
      ...lensFields,
      '',
      '- When a cluster\'s trend contradicts what they ranked as most important, name the contradiction once as fact (no question back).',
      '- When financial_awareness is "beginner", swap jargon for tangible comparisons. When "advanced", keep numbers tight and skip framing they already know.',
      '- When you spot behaviour that lines up with a stated spending trigger, name the trigger as context, never as a judgment.',
      '- Do not re-ask any of these.',
    ].join('\n');
  }

  return `## What you know about this user\n\n${fields.join('\n')}${completenessNote}${doNotAskBlock}${lensBlock}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildFinancialContext(snapshots: any[] | null, recurring: any[] | null, profile: any): string {
  const parts: string[] = [];

  // Monthly snapshots
  if (snapshots && snapshots.length > 0) {
    const latest = snapshots[0];
    const currency = profile?.primary_currency || 'EUR';

    parts.push(`## Financial summary — ${snapshots.length} month${snapshots.length > 1 ? 's' : ''} of data available`);
    if (profile?.net_monthly_income) parts.push(`Net monthly income: ${currency} ${profile.net_monthly_income}`);

    parts.push(`\n### Latest month (${latest.month})`);
    if (latest.total_spending) parts.push(`Total spending: ${currency} ${latest.total_spending}`);
    if (latest.total_income) parts.push(`Total income: ${currency} ${latest.total_income}`);
    if (latest.surplus_deficit) parts.push(`Surplus/deficit: ${currency} ${latest.surplus_deficit}`);
    if (latest.total_fixed_costs != null) {
      parts.push(`Fixed costs (rent + reconciled recurring): ${currency} ${latest.total_fixed_costs}`);
      if (profile?.net_monthly_income) {
        const freeCash = Math.round((Number(profile.net_monthly_income) - Number(latest.total_fixed_costs)) * 100) / 100;
        parts.push(`Free cash flow (income − fixed costs): ${currency} ${freeCash}`);
      }
    }
    if (latest.spending_by_category && Object.keys(latest.spending_by_category).length > 0) {
      // Include uncategorised as a labelled signal. Hiding it caused the LLM
      // to deny the bucket existed when users asked directly, and to invent
      // terms like "no idea" to rationalise the gap. The user needs to see
      // the gap honestly so they can re-categorise — that's how the system
      // gets more accurate, per the trust-first principle.
      parts.push(`Spending by category: ${JSON.stringify(latest.spending_by_category)}`);
    }
    if (latest.spending_by_value_category && Object.keys(latest.spending_by_value_category).length > 0) {
      parts.push(`Spending by value category: ${JSON.stringify(latest.spending_by_value_category)}`);
    }
    if (latest.vs_previous_month_pct !== null && latest.vs_previous_month_pct !== undefined) {
      parts.push(`vs previous month: ${latest.vs_previous_month_pct > 0 ? '+' : ''}${latest.vs_previous_month_pct}%`);
    }

    // Historical months
    if (snapshots.length > 1) {
      parts.push('\n### Historical months');
      for (const snap of snapshots.slice(1)) {
        let line = `- ${snap.month}: ${currency} ${snap.total_spending} spending`;
        if (snap.total_income) line += `, ${currency} ${snap.total_income} income`;
        if (snap.surplus_deficit !== null && snap.surplus_deficit !== undefined) {
          line += `, ${snap.surplus_deficit >= 0 ? '+' : ''}${currency} ${snap.surplus_deficit} surplus/deficit`;
        }
        parts.push(line);
      }
    }
  }

  // Recurring expenses
  if (recurring && recurring.length > 0) {
    const recurringLines = recurring.map((r) => {
      const freq = r.frequency === 'monthly' ? '/mo' : `/${r.frequency}`;
      return `- ${r.name}${r.provider ? ` (${r.provider})` : ''}: ${r.currency || 'EUR'} ${r.amount}${freq}`;
    });
    parts.push(`\nRecurring expenses:\n${recurringLines.join('\n')}`);

    // Compute approximate monthly fixed costs
    const monthlyFixed = recurring.reduce((sum, r) => {
      if (r.frequency === 'monthly') return sum + Number(r.amount);
      if (r.frequency === 'bimonthly') return sum + Number(r.amount) / 2;
      if (r.frequency === 'quarterly') return sum + Number(r.amount) / 3;
      if (r.frequency === 'annual' || r.frequency === 'yearly') return sum + Number(r.amount) / 12;
      return sum + Number(r.amount);
    }, 0);
    parts.push(`\nEstimated monthly fixed costs: ${profile?.primary_currency || 'EUR'} ${monthlyFixed.toFixed(2)}`);

    // Bills needing attention (lightweight — drop if token budget tight)
    const attentionBills: string[] = [];
    const now = Date.now();
    for (const r of recurring) {
      if (r.contract_end_date) {
        const daysUntil = Math.ceil((new Date(r.contract_end_date).getTime() - now) / (1000 * 60 * 60 * 24));
        if (daysUntil > 0 && daysUntil <= 60) {
          attentionBills.push(`- ${r.provider || r.name}: contract ends in ${daysUntil} days${r.potential_saving_monthly ? ` (potential saving: ${profile?.primary_currency || 'EUR'} ${r.potential_saving_monthly}/mo)` : ''}`);
        }
      }
      if (!r.contract_end_date && r.potential_saving_monthly && Number(r.potential_saving_monthly) > 0) {
        attentionBills.push(`- ${r.provider || r.name}: potential saving ${profile?.primary_currency || 'EUR'} ${r.potential_saving_monthly}/mo`);
      }
    }
    if (attentionBills.length > 0) {
      parts.push(`\nBills needing attention:\n${attentionBills.slice(0, 3).join('\n')}`);
    }
  }

  if (parts.length === 0) return '';

  parts.push('\nIMPORTANT: Always use these system-provided numbers. Never attempt to add, subtract, or calculate financial figures yourself.');

  return parts.join('\n');
}

// ── Country benchmarks ───────────────────────────────────────────────────────
// Pulls average-household spending from the `benchmarks` table for the user's
// country, chooses one row per category (preferring a household-size segment
// that matches the user), and formats a short instructional block for the CFO.
// Returns null when the country is missing or has no rows.

const COUNTRY_NAMES: Record<string, { name: string; currencySymbol: string }> = {
  ES: { name: 'Spain', currencySymbol: '€' },
  GB: { name: 'the UK', currencySymbol: '£' },
  IE: { name: 'Ireland', currencySymbol: '€' },
  US: { name: 'the US', currencySymbol: '$' },
  FR: { name: 'France', currencySymbol: '€' },
  DE: { name: 'Germany', currencySymbol: '€' },
  PT: { name: 'Portugal', currencySymbol: '€' },
  NL: { name: 'the Netherlands', currencySymbol: '€' },
  IT: { name: 'Italy', currencySymbol: '€' },
};

async function getCountryBenchmarks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<string> {
  const country: string | null = profile?.country ?? null;
  if (!country) return '';

  try {
    const { data: rows } = await supabase
      .from('benchmarks')
      .select('category, segment, average_monthly, source')
      .eq('country', country)
      .or('valid_until.is.null,valid_until.gte.' + new Date().toISOString().slice(0, 10));

    if (!rows || rows.length === 0) return '';

    // Prefer segment based on household size. Without reliable household data,
    // fall back to 'default', then the first available segment.
    const dependents = Number(profile?.dependents ?? 0);
    const partnered = !!profile?.partner_employment_status || profile?.relationship_status === 'couple' || profile?.relationship_status === 'married';
    let preferred: string = 'default';
    if (dependents >= 2) preferred = '4_person';
    else if (dependents === 1 || partnered) preferred = '2_person';
    else if (!partnered && dependents === 0) preferred = 'default';

    const segmentScore = (seg: string | null): number => {
      if (seg === preferred) return 3;
      if (seg === 'default') return 2;
      if (!seg) return 1;
      return 0;
    };

    type Row = { category: string; segment: string | null; average_monthly: number; source: string };
    const bestByCategory = new Map<string, Row>();
    for (const r of rows as Row[]) {
      const existing = bestByCategory.get(r.category);
      if (!existing || segmentScore(r.segment) > segmentScore(existing.segment)) {
        bestByCategory.set(r.category, r);
      }
    }

    if (bestByCategory.size === 0) return '';

    const meta = COUNTRY_NAMES[country] ?? { name: country, currencySymbol: '' };
    const lines: string[] = [];
    lines.push(`## Country benchmarks (${meta.name}, monthly household averages)`);
    lines.push('');
    lines.push('These are approximate national averages for reference only.');
    lines.push(`Always phrase comparisons as "typical for ${meta.name}" or "average household" — NEVER "normal".`);
    lines.push('Never quote them as exact figures. Use them in the first post-upload insight — that is where they hit hardest.');
    lines.push('');
    for (const [category, r] of Array.from(bestByCategory.entries()).sort()) {
      const segLabel = r.segment && r.segment !== 'default' ? ` (${r.segment.replace('_', '-')})` : '';
      lines.push(`- ${category}: ${meta.currencySymbol}${Number(r.average_monthly).toFixed(0)}${segLabel} — source: ${r.source}`);
    }
    lines.push('');
    lines.push('Comparison rules:');
    lines.push('- If the user\'s spending is 1.5x+ the benchmark, name it: "That\'s roughly double what\'s typical for ' + meta.name + '."');
    lines.push('- If significantly below, note it positively: "Your [category] is well below typical for ' + meta.name + '."');
    lines.push('- If a category has no row here, do NOT invent a number.');
    lines.push('- One benchmark comparison per insight, not a list.');

    return lines.join('\n');
  } catch {
    return '';
  }
}

// Posture-aware quotable facts. Only emits a section when the user has a
// surviving or planning posture above the confidence gate (see posture-helpers).
// These facts come from the deterministic detector layer in Session B —
// the LLM may quote them without anti-hallucination concern.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPostureContext(profile: any, recurring: any[] | null): string {
  const transform = getTransformPosture(profile);
  if (!transform) return '';

  const currency = profile?.primary_currency || 'EUR';
  const sym = currencySymbol(currency);
  const trajectory = profile?.balance_trajectory as string | null | undefined;
  const lines: string[] = [];

  if (transform === 'surviving') {
    const runway = profile?.runway_days;
    if (runway == null) return '';

    lines.push('## Posture: surviving (runway-aware)');
    lines.push('### QUOTABLE POSTURE FACTS — these are computed, the LLM may cite them');
    lines.push(`- "Runway: ${runway} days at current spend rate"`);
    if (trajectory) {
      lines.push(`- "Balance trajectory over the last 3 months: ${trajectory.replace(/_/g, ' ')}"`);
    }

    // Count recurring bills falling within the next 14 days based on billing_day.
    const today = new Date();
    const todayDay = today.getDate();
    const dueIn14 = (recurring ?? []).filter((r: { billing_day?: number | null }) => {
      const bd = r?.billing_day;
      if (bd == null || bd < 1 || bd > 31) return false;
      const daysUntil = bd >= todayDay
        ? bd - todayDay
        : (30 - todayDay) + bd; // next month occurrence, ~30-day approx
      return daysUntil <= 14;
    }).length;
    lines.push(`- "Recurring bills due in the next 14 days: ${dueIn14}"`);
  }

  if (transform === 'planning') {
    const t3mIncome = profile?.t3m_income_monthly;
    const t3mSpend = profile?.t3m_spend_monthly;
    if (t3mIncome == null || t3mSpend == null) return '';

    const t3mNet = Math.round((Number(t3mIncome) - Number(t3mSpend)) * 3);
    const incomeRounded = Math.round(Number(t3mIncome));
    const spendRounded = Math.round(Number(t3mSpend));
    const netSign = t3mNet >= 0 ? '+' : '−';

    lines.push('## Posture: planning (T3M-aware)');
    lines.push('### QUOTABLE POSTURE FACTS — these are computed, the LLM may cite them');
    lines.push(`- "Trailing-3-month income: ${sym}${incomeRounded.toLocaleString('en-GB')}/month"`);
    lines.push(`- "Trailing-3-month spend: ${sym}${spendRounded.toLocaleString('en-GB')}/month"`);
    lines.push(`- "Last 3 months net: ${netSign}${sym}${Math.abs(t3mNet).toLocaleString('en-GB')}"`);
    if (trajectory) {
      lines.push(`- "Balance trajectory over the last 3 months: ${trajectory.replace(/_/g, ' ')}"`);
    }
    lines.push('');
    lines.push('AVAILABLE: t3m_income_monthly may be cited as "trailing-3-month income" but never as "your monthly income" — the underlying flow is variable.');
  }

  return lines.join('\n');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPortraitContext(portrait: any[] | null, valueMap: any): string {
  const parts: string[] = [];

  // Determine whether this session reflects real behaviour or only the sample exercise.
  const isPersonalRetake = valueMap?.type === 'personal' || valueMap?.is_real_data === true;
  const archetypeName = valueMap?.archetype_name as string | undefined;
  const archetypeSubtitle = valueMap?.archetype_subtitle as string | undefined;
  const archetypeTraits = Array.isArray(valueMap?.archetype_traits)
    ? (valueMap.archetype_traits as string[])
    : [];
  const shiftNarrative = valueMap?.shift_narrative as string | undefined;
  const archetypeHistory = Array.isArray(valueMap?.archetype_history)
    ? (valueMap.archetype_history as Array<{ name?: string; archived_at?: string }>)
    : [];

  if (valueMap) {
    if (isPersonalRetake) {
      parts.push('## Value Map archetype (regenerated from real behaviour)');
      parts.push('');
      parts.push("The archetype below was generated from the user's actual transactions,");
      parts.push('correction signals, and monthly spending trends — not the onboarding sample.');
      parts.push('Treat it as an up-to-date read on their financial personality.');
      parts.push('');
    } else {
      parts.push('## Value perceptions (from the Value Map sample exercise)');
      parts.push('');
      parts.push('IMPORTANT: The data below comes from a short perception exercise where the user');
      parts.push('classified SAMPLE transactions into Foundation / Investment / Burden / Leak.');
      parts.push("These are NOT the user's real spending. The numbers below are percentages of");
      parts.push('sample items the user put in each bucket — they do NOT represent real spending amounts.');
      parts.push('You have no real transaction data yet until they upload a bank statement.');
      parts.push('');
      parts.push('What this tells you about the user:');
    }

    if (archetypeName) {
      parts.push(`- Archetype: ${archetypeName}${archetypeSubtitle ? ` — ${archetypeSubtitle}` : ''}`);
    } else if (valueMap.personality_type) {
      const personality = PERSONALITIES[valueMap.personality_type];
      const displayName = personality?.name ?? valueMap.personality_type;
      parts.push(`- Archetype: ${displayName} — ${personality?.headline ?? 'how they relate to money'}`);
    }

    if (archetypeTraits.length > 0) {
      parts.push('- Traits:');
      for (const t of archetypeTraits) {
        parts.push(`    - ${t}`);
      }
    }

    if (valueMap.dominant_quadrant) {
      const lensLabel = isPersonalRetake
        ? 'Dominant real-data lens'
        : 'Dominant perception lens (sample items)';
      parts.push(`- ${lensLabel}: ${valueMap.dominant_quadrant}`);
    }
    if (valueMap.breakdown) {
      const breakdown = valueMap.breakdown as Record<string, { percentage: number; count: number }>;
      const parts2 = Object.entries(breakdown)
        .filter(([, v]) => v.percentage > 0)
        .sort((a, b) => b[1].percentage - a[1].percentage)
        .map(([q, v]) => `${q}: ${v.percentage}%`);
      if (parts2.length > 0) {
        const label = isPersonalRetake
          ? 'Real distribution'
          : 'Perception distribution (sample items, NOT spending)';
        parts.push(`- ${label}: ${parts2.join(', ')}`);
      }
    }
    if (valueMap.merchants_by_quadrant && !isPersonalRetake) {
      const mbq = valueMap.merchants_by_quadrant as Record<string, string[]>;
      const entries = Object.entries(mbq).filter(([, v]) => v.length > 0);
      if (entries.length > 0) {
        parts.push('- Sample categories they associate with each quadrant:');
        for (const [quadrant, merchants] of entries) {
          parts.push(`    - ${quadrant}: ${merchants.join(', ')}`);
        }
      }
    }

    // ── Archetype evolution (shift narrative) ──
    // Only include when there IS a history AND the latest regeneration was recent-ish.
    if (shiftNarrative && archetypeHistory.length > 0) {
      const latestHistory = archetypeHistory[archetypeHistory.length - 1];
      const previousName = latestHistory?.name ?? 'previous archetype';
      parts.push('');
      parts.push('## Archetype evolution');
      parts.push(`- Previous archetype: ${previousName}`);
      parts.push(`- What shifted: ${shiftNarrative}`);
      parts.push('- You can reference this evolution naturally in conversation when it helps.');
    }

    parts.push('');
    if (isPersonalRetake) {
      parts.push('USE THIS DATA TO PERSONALISE GUIDANCE:');
      parts.push('- This archetype reflects how the user actually spends, not how they claim to.');
      parts.push('- Reference specific traits and merchants naturally — do not list them back verbatim.');
      parts.push('- When spending contradicts a stated value, name it once without judgement.');
    } else {
      parts.push('USE THIS DATA AS A LENS, NOT AS FACTS:');
      parts.push('- Say "you see X as a burden" NOT "X is 58% of your spending"');
      parts.push('- Say "you categorised Y as a leak" NOT "you\'re leaking money on Y"');
      parts.push('- Do NOT quote the breakdown percentages as if they represent real spending amounts');
      parts.push('- The merchants/categories listed are from the sample exercise — treat them as indicators');
      parts.push("  of the user's mental model, not confirmed spending behaviour");
    }
  }

  // Behavioral traits
  if (portrait && portrait.length > 0) {
    parts.push('\n## Behavioral traits');
    for (const trait of portrait) {
      parts.push(`- ${trait.trait_key}: ${trait.trait_value} (confidence: ${trait.confidence})`);
    }
  }

  if (parts.length === 0) return '';

  parts.push("\nUse these traits to personalise your guidance. Reference them naturally — don't list them back to the user.");

  return parts.join('\n');
}

const ADVISORY_BOUNDARIES = `## Advisory boundaries — what the CFO can and cannot do with balance sheet data

YOU CAN:
- State the user's net worth and how it's changing over time
- Show asset allocation percentages (e.g., "78% equities, 15% cash, 7% pension")
- Compare their allocation to generic, widely-published age-based benchmarks (e.g., "a common rule of thumb is 100 minus age in equities")
- Name the interest rate on their savings and note if it's below current best-available rates without recommending a specific provider
- Calculate the cost of debt (e.g., "the credit card costs £X/month in interest")
- Calculate debt payoff timelines under different payment scenarios
- Calculate pension projections based on current contribution rates and generic growth assumptions
- Assess emergency fund adequacy (accessible savings vs monthly essential spending)
- Explain financial concepts (compound interest, LTV, tax-sheltered wrappers, diversification)
- Flag observations (e.g., "no pension contributions recorded" or "100% of investments are in one asset class")

YOU MUST NOT:
- Recommend specific financial products, funds, ETFs, platforms, or providers by name
- Suggest buy, sell, or hold decisions on any specific security or asset
- Recommend specific portfolio allocations (e.g., "60/40 stocks/bonds")
- Provide suitability assessments for any financial product
- Give specific tax guidance (flag the topic and signpost a specialist)
- Suggest moving money to a specific institution
- Make predictions about market performance
- Name third-party services or content sites (Vanguard, ISA, MoneySavingExpert, NerdWallet, Finanztest are all forbidden — generic role names like "tax adviser" or "comparison service" are fine)

WHEN THE USER ASKS A PRODUCT-SPECIFIC QUESTION:
Decline briefly within the remit. Show what the CFO can do — the numbers, the concepts, the tradeoffs. Phrase the boundary as observation, not first-person: "That sits outside the remit. For regulated product decisions, a qualified financial adviser is the route." Never name a specific service or site.`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildBalanceSheetContext(assets: any[] | null, liabilities: any[] | null): string {
  const assetList = assets || [];
  const liabilityList = liabilities || [];
  if (!assetList.length && !liabilityList.length) return '';

  const totalAssets = assetList.reduce(
    (s, a) => s + (Number(a.current_value) || 0),
    0,
  );
  const totalLiabs = liabilityList.reduce(
    (s, l) => s + (Number(l.outstanding_balance) || 0),
    0,
  );
  const netWorth = totalAssets - totalLiabs;
  const accessible = assetList
    .filter((a) => a.is_accessible === true)
    .reduce((s, a) => s + (Number(a.current_value) || 0), 0);

  let out = `## Balance sheet (system-computed — use these numbers, don't calculate yourself)\n\n`;
  out += `Net worth: ${netWorth.toFixed(0)}\n`;
  out += `Total assets: ${totalAssets.toFixed(0)} (accessible: ${accessible.toFixed(0)})\n`;
  out += `Total liabilities: ${totalLiabs.toFixed(0)}\n\n`;

  if (assetList.length) {
    out += `### Assets\n`;
    for (const a of assetList) {
      out += `- ${a.name} (${a.asset_type}): ${a.currency} ${(Number(a.current_value) || 0).toFixed(0)}`;
      if (a.provider) out += ` @ ${a.provider}`;
      if (a.is_accessible === false) out += ` [locked]`;
      if (a.asset_type === 'savings' && a.details?.interest_rate != null) {
        out += ` — ${a.details.interest_rate}% interest`;
      }
      if (a.asset_type === 'pension' && a.details?.employer_contribution_pct != null) {
        out += ` — employer ${a.details.employer_contribution_pct}% + employee ${a.details.employee_contribution_pct ?? '?'}%`;
      }
      out += `\n`;
    }
    out += `\n`;
  }

  if (liabilityList.length) {
    out += `### Liabilities\n`;
    for (const l of liabilityList) {
      out += `- ${l.name} (${l.liability_type}): ${l.currency} ${Number(l.outstanding_balance).toFixed(0)} outstanding`;
      if (l.interest_rate != null) out += ` — ${l.interest_rate}% APR`;
      if (l.actual_payment != null) out += ` — paying ${l.currency} ${l.actual_payment}/${l.payment_frequency || 'mo'}`;
      if (l.is_priority) out += ` [PRIORITY]`;
      out += `\n`;
    }
    out += `\n`;
  }

  out += `IMPORTANT: Use these system-provided balance sheet numbers. Do not calculate net worth, gains, or totals yourself. If you need a calculation not shown here (e.g., debt payoff timeline, pension projection), tell the user those tools are coming in a future update.\n\n`;
  out += ADVISORY_BOUNDARIES;
  return out;
}

function buildGoalsContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  goals: any[] | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actions: any[] | null,
  primaryGoal: PrimaryGoal | null,
  primaryGoalUnavailable = false,
): string {
  const parts: string[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderGoalLine = (goal: any): string => {
    let line = `- ${goal.name}`;
    if (goal.target_amount) line += `: target ${goal.target_amount}`;
    if (goal.current_amount) line += `, current ${goal.current_amount}`;
    if (goal.target_date) line += `, by ${goal.target_date}`;
    if (goal.monthly_required_saving) {
      // Investment-goal pace already accounts for compound growth — flag it so
      // the CFO frames it as such, not as a flat saving requirement.
      const basis = goal.type === 'investment' ? '/mo, growth-adjusted' : '/mo';
      line += ` (need ${goal.monthly_required_saving}${basis})`;
    }
    if (goal.on_track != null) line += goal.on_track ? ' ✓ on track' : ' ✗ off track';
    return line;
  };

  // Always emit the heading. The explicit no-goal marker is the signal the
  // CFO is trained to act on — silence in this slot produces silence in the
  // behaviour (Constitution v1.3 §3 Goal-awareness, no-goal protocol).
  parts.push('## Active goals');

  if (primaryGoal == null) {
    if (goals && goals.length > 0) {
      // Primary-goal signal came back null/unavailable, but the multi-goal
      // fetch succeeded and has rows — render those rather than (wrongly)
      // telling the CFO there is no goal.
      for (const goal of goals) parts.push(renderGoalLine(goal));
    } else if (primaryGoalUnavailable) {
      // The query errored — do NOT assert "no goal". Silence-with-reason so the
      // CFO doesn't contradict a goal it referenced moments earlier.
      parts.push('(Goal status temporarily unavailable — do not state that the user has no goal.)');
    } else {
      parts.push('No active goal set.');
    }
  } else if (goals && goals.length > 0) {
    for (const goal of goals) parts.push(renderGoalLine(goal));
  } else {
    // Defensive fallback: primaryGoal exists but the multi-goal fetch failed
    // or returned empty. Render the primary alone so the CFO is not blind to
    // the goal it has just been told exists.
    parts.push(renderGoalLine(primaryGoal));
  }

  if (actions && actions.length > 0) {
    parts.push('\n## Pending action items');
    for (const action of actions) {
      let line = `- ${action.title}`;
      if (action.category) line += ` [${action.category}]`;
      if (action.priority) line += ` (${action.priority})`;
      if (action.due_date) line += ` due ${action.due_date}`;
      parts.push(line);
    }
  }

  return parts.join('\n');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTripsContext(trips: any[] | null, profile: any): string {
  if (!trips || trips.length === 0) return '';

  const currency = profile?.primary_currency || 'EUR';
  const lines = trips.map(t => {
    let line = `- ${t.name}`;
    if (t.destination) line += ` (${t.destination})`;
    line += `: ${t.status}`;
    if (t.total_estimated) line += `, budget ${currency} ${t.total_estimated}`;
    if (t.start_date) line += `, ${t.start_date}`;
    return line;
  });

  return `## Upcoming trips\n\n${lines.join('\n')}`;
}

// Render the user's open experiments so the CFO knows what's running, what's
// awaiting outcome, and what proposals are still on the table. The auto-prompt
// for an overdue outcome lives in the "Outcome owed" block — the LLM is
// instructed to ask once, near the start of its first response, when this
// block is present.
async function buildExperimentContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<string> {
  try {
    const { data, error } = await supabase
      .from('proposed_experiments')
      .select(
        'id, template_id, title, success_criterion, status, starts_at, ends_at, outcome_reported_at, proposed_at, duration_days',
      )
      .eq('user_id', userId)
      .is('deleted_at', null)
      .in('status', ['proposed', 'accepted', 'active'])
      .order('proposed_at', { ascending: false });
    if (error || !Array.isArray(data) || data.length === 0) return '';

    const nowMs = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    interface ExperimentRow {
      id: string;
      template_id: string | null;
      title: string | null;
      success_criterion: string | null;
      status: string;
      starts_at: string | null;
      ends_at: string | null;
      outcome_reported_at: string | null;
      proposed_at: string;
      duration_days: number | null;
    }

    const rows = data as ExperimentRow[];

    const active = rows.filter(
      (r) =>
        (r.status === 'accepted' || r.status === 'active') &&
        r.ends_at !== null &&
        new Date(r.ends_at).getTime() > nowMs - ONE_DAY,
    );
    const awaiting = rows.filter(
      (r) =>
        (r.status === 'accepted' || r.status === 'active') &&
        r.outcome_reported_at === null &&
        r.ends_at !== null &&
        new Date(r.ends_at).getTime() <= nowMs - ONE_DAY,
    );
    const openProposals = rows.filter((r) => r.status === 'proposed');

    if (active.length === 0 && awaiting.length === 0 && openProposals.length === 0) {
      return '';
    }

    const sections: string[] = ['## Experiments'];

    if (active.length > 0) {
      sections.push('### Currently active');
      for (const r of active) {
        const endDate = r.ends_at ? r.ends_at.slice(0, 10) : 'TBD';
        sections.push(
          `- ${r.title ?? r.template_id ?? r.id} — ends ${endDate}. Success: ${r.success_criterion ?? 'see template'}. (id: ${r.id})`,
        );
      }
    }

    if (awaiting.length > 0) {
      sections.push('### Outcome owed');
      sections.push(
        'Ask once, naturally, near the start of this turn. Then call `record_experiment_outcome` with the user\'s answer (yes / partial / no). Do NOT moralise about partial or no.',
      );
      for (const r of awaiting) {
        sections.push(
          `- "${r.title ?? r.template_id ?? r.id}" ended ${r.ends_at?.slice(0, 10) ?? 'recently'}. Success criterion was: ${r.success_criterion ?? 'see template'}. Use [OPTIONS]\\n- Yes I stuck with it\\n- Partially\\n- No\\n[/OPTIONS] (id: ${r.id})`,
        );
      }
    }

    if (openProposals.length > 0) {
      sections.push('### Open proposals (awaiting user decision)');
      sections.push(
        "The user can still accept these from a previous turn. Don't re-propose the same template — present the alternatives or wait for their answer.",
      );
      for (const r of openProposals) {
        sections.push(
          `- "${r.title ?? r.template_id ?? r.id}" proposed ${r.proposed_at.slice(0, 10)} (id: ${r.id}, template_id: ${r.template_id ?? 'unknown'})`,
        );
      }
    }

    return sections.join('\n');
  } catch (err) {
    console.error('[context-builder] buildExperimentContext error:', err);
    return '';
  }
}

function buildToolUsageInstructions(): string {
  return `## Available tools

When the user asks about spending, budgets, or comparisons, call the appropriate tool. NEVER calculate financial figures yourself — always use a tool.

- **get_spending_summary**: "How much did I spend on X?" or "What did I spend last month?" Always use this for specific date ranges or category filters rather than citing numbers from the system prompt.
- **compare_months**: "How was March vs February?" or any month-over-month comparison.
- **get_value_breakdown**: "Show me my Foundation/Investment/Burden/Leak split" for a period.
- **calculate_monthly_budget**: "What's my budget?" or "How much can I spend?" Also use as context when discussing any spending number relative to income.
- **get_action_items**: "What's on my to-do list?" or "What should I be working on?"
- **create_action_item**: When a conversation produces a concrete next step. Always confirm with the user before creating.
- **create_goal**: "I want to save for X" / "Set a goal to save €Y" / any non-event savings target (emergency fund, house deposit, big purchase, etc.). Confirm goal name, target amount, and optional deadline with the user, then call. For trips, weddings, gifts, or other time-bound events, use plan_event instead.
- **model_scenario**: "What if I got a raise?" / "What if I cut dining by 30%?" / "What would a mortgage look like?" / "What if I had kids?" / "What if I changed careers?" / "How would my investments grow?" All 6 scenario types are available. All calculations are server-side.
- **plan_event**: "Help me plan a trip" / "I need to budget for my sister's wedding" / "I want to plan a gift for X" — create a budget, funding plan, and savings goal for any time-bound spending occasion. Pass kind (travel | celebration | gift | other) to disambiguate. Call this AFTER collecting destination/occasion, dates, style, and companions, and AFTER researching real costs. All funding calculations are server-side.
- **analyse_gap**: "How does my spending compare to what I said I value?" The Gap analysis between Value Map perception and actual spending.
- **suggest_value_recategorisation**: "Are any of my categories wrong?" Find potentially miscategorised transactions.
- **check_value_checkin_ready**: THE ONLY tool to use when the user asks for a "value check-in", "check-in", "Value Map", "let me classify some transactions", or any variant. It checks availability then you emit a tappable CTA block that opens a dedicated card-based UI at /value-map?mode=checkin. DO NOT classify transactions inline in chat when the user asks for a check-in — always route to the CTA. If available, reply with one casual sentence ("Yep, 12 transactions ready — want to go?") plus this exact block on its own line: \`[CTA:value_checkin]Start value check-in (N transactions)[/CTA]\`.
- **get_value_review_queue**: Fetch a SINGLE merchant group for a mid-conversation, inline discussion — e.g. the user mentioned dining out and you want to ask "so what's the story with the three Aldi trips?". Do NOT use this when the user explicitly asked for a "check-in" — that's what check_value_checkin_ready is for. Do NOT use this to batch-classify; one merchant group at a time, woven naturally into the conversation.
- **record_value_classifications**: Save value category classifications after the user tells you how they feel about a merchant IN CHAT. Only used with the inline flow above (get_value_review_queue). The card-based check-in saves its own classifications server-side — do NOT call this after the user completes a check-in.
- **delete_value_rule**: Remove a saved value-category rule when the user says it's wrong or misclassifying ("stop tagging Aldi as a leak", "that rule is broken", "delete my Deliveroo rule"). Pass \`merchant_pattern\` (the merchant name) or \`rule_id\` if known. ALWAYS confirm with the user before calling — deletion is permanent. Does not touch past transactions, only stops future auto-categorisation. After deletion, briefly offer to reclassify via a check-in if they want a fresh rule.
- **search_bill_alternatives**: "Can I get a better deal on electricity?" / "Help me switch internet provider." Researches alternatives and compares with the user's current plan.
- **propose_catalog_experiment**: When the conversation has surfaced a behavioural pattern AND the user has paused on it, propose ONE catalog experiment derived from that pattern. Always follow with an [OPTIONS] block: "Yes, let's try it" / "Pick a different one" / "Not right now". Capacity (active limit) and the 90-day novelty window are enforced server-side — if rejected, do not push, acknowledge and move on.
- **accept_experiment**: Call when the user says yes to a proposed experiment. Sets it active and starts the clock.
- **decline_experiment**: Call when the user says "Not right now". For "Pick a different one", call this AND immediately propose_catalog_experiment with the next alternative.
- **record_experiment_outcome**: Call after the user answers the outcome ask (yes / partial / no). Capture any free-text reason in \`note\`. Do not moralise about partial or no.
- **list_active_experiments**: Read-only. Use at the start of a conversation to know what's active and whether any are awaiting outcome.
- **propose_experiment** (DEPRECATED — prefer propose_catalog_experiment): Use only when you need a custom hypothesis with computed impact bands that doesn't match a catalog template.
- **upsert_asset**: Call whenever the user mentions a savings balance, investment, pension pot, crypto holding, or property they own — whether volunteered or in reply to a question. Use asset_id to update an existing entry, omit it to create a new one. Always confirm the saved details naturally afterwards.
- **upsert_liability**: Call whenever the user mentions a debt balance — mortgage, student loan, credit card, personal loan, BNPL, overdraft. Use liability_id to update, omit to create. Always confirm afterwards.
- **get_balance_sheet**: "What's my net worth?" / "What's my overall position?" / when you need balance sheet context to answer a question about emergency funds, goal feasibility, or debt burden. Returns totals, itemised lists, and a data_gaps array — use the gaps to naturally prompt for missing information, never to push.

BALANCE SHEET UPLOADS:
If the user mentions having multiple holdings, a complex portfolio, a pension statement, a mortgage statement, or a credit card balance they want to import, tell them they can drag a holdings CSV, screenshot, or PDF into the Balance Sheet upload and it will be parsed into assets or debts automatically. Prefer upload over typing numbers one-by-one when they have more than two or three positions.

RULES:
- ALWAYS call a tool when you need a number. Never estimate, recall, or calculate.
- You can call multiple tools in sequence — e.g., get_spending_summary then compare with calculate_monthly_budget.
- If a tool returns an error about missing data, explain what's needed and offer to help collect it.
- When presenting tool results, be conversational — frame numbers in context of the user's goals and values, don't dump raw data.
- After creating an action item, briefly confirm and move on.
- When the message that wraps a tool result delivers a meaningful finding (gap, cuts, goal progress, accountability, pushback, windfall analysis), sign off "— C." on its own line. Routine confirmations (e.g. "Saved.") do not need a sign-off.`;
}

async function buildProfilingContext(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<string> {
  let questions: ProfileQuestion[];
  try {
    questions = await getNextQuestions(userId, supabase);
  } catch {
    return '';
  }

  if (questions.length === 0) return '';

  const lines = questions.map((q) => {
    let line = `- **${q.field}**: "${q.label}"`;
    line += `\n  Rationale: ${q.rationale}`;
    if (q.input_config.input_type === 'single_select' || q.input_config.input_type === 'multi_select') {
      line += ` → Use request_structured_input tool (${q.input_config.input_type})`;
      if (q.input_config.options) {
        line += ` with options: ${q.input_config.options.map(o => o.label).join(', ')}`;
      }
    } else if (q.input_config.input_type === 'currency_amount' || q.input_config.input_type === 'number') {
      line += ` → Use request_structured_input tool (${q.input_config.input_type})`;
    }
    return line;
  });

  return `## Information to gather (if natural)

The following profile fields are empty and would sharpen the guidance.
DO NOT ask these as a list. DO NOT ask more than one per turn.
Weave them in naturally when the topic is relevant.
If the conversation doesn't naturally lead to these topics, don't force it.

${lines.join('\n\n')}

When asking for precise data (numbers, selections), use the request_structured_input tool
to render an interactive component. For information shared naturally in conversation,
use the update_user_profile tool instead.

Remember: ask late, ask little. One question, naturally placed,
is better than a checklist. The user should feel like they're having a conversation,
not filling out a form.`;
}

async function getValueCheckinNudgeContext(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  conversationType?: string,
): Promise<string> {
  // Don't nudge immediately after an upload — let the first insight land.
  if (conversationType === 'post_upload' || conversationType === 'onboarding') return ''

  try {
    // Count uncertain transactions
    const { count, error } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('value_confirmed_by_user', false)
      .or('value_confidence.is.null,value_confidence.lt.0.7')
      .lt('amount', 0)

    if (error) return ''
    const uncertainCount = count ?? 0
    if (uncertainCount < 10) return ''

    // Last check-in completion
    const { data: lastEvent } = await supabase
      .from('user_events')
      .select('created_at')
      .eq('profile_id', userId)
      .eq('event_type', 'value_checkin_completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const lastAt = lastEvent?.created_at
      ? new Date(lastEvent.created_at)
      : null
    if (lastAt) {
      const daysSince = (Date.now() - lastAt.getTime()) / (1000 * 60 * 60 * 24)
      if (daysSince < 7) return ''
    }

    return `## Value check-in opportunity

You have ${uncertainCount} transactions where you're uncertain about the value category. You can offer a tappable "value check-in" when the moment feels natural — e.g. after discussing a spending category, when the user asks about their values view, or mid-conversation if the topic drifts toward how they feel about their money.

HOW TO OFFER IT:
1. First call check_value_checkin_ready to verify availability and get the count.
2. Then, in your next message, frame it casually — "Want to? It takes about two minutes" — and include this exact CTA block (replace N with the count):

[CTA:value_checkin]Start value check-in (N transactions)[/CTA]

RULES:
- Maximum once per conversation. Don't re-offer if the user declined.
- Never suggest immediately after an upload — let the first insight land first.
- Don't push if the user declines or changes topic.
- Don't explain the Value Map or the mechanics — just "want to do a quick check-in?"`
  } catch {
    return ''
  }
}

async function getRetakeSuggestionContext(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  conversationType?: string,
): Promise<string> {
  // Don't propose a retake right after an upload — insights first.
  if (conversationType === 'post_upload' || conversationType === 'onboarding') return ''

  try {
    // Dynamic import avoids circular deps (retake-trigger imports selectRetakeCandidates
    // which needs the review-queue helper; this context-builder is high-level).
    const { shouldTriggerRetake } = await import('@/lib/value-map/retake-trigger')
    const decision = await shouldTriggerRetake(supabase, userId)
    if (!decision.trigger) return ''

    const topLabel =
      decision.top_merchants.length > 0
        ? decision.top_merchants.slice(0, 3).join(', ')
        : 'several merchants'

    return `## Retake opportunity (CFO-proposed)

The user has ${decision.low_confidence_count} low-confidence transactions in the last 60 days — enough to make a personal Value Map retake meaningful. Uncertain merchants include: ${topLabel}.

If the conversation allows, you can offer a tappable retake CTA. This is distinct from the value check-in: a retake is a deeper, archetype-regenerating exercise that leverages the user's actual spending.

WHEN TO OFFER:
- When the user asks about their financial personality, values, or "why do you think X about me"
- When you're about to reference the archetype and notice it might be stale
- In a monthly review conversation, as a natural follow-up
- When the user expresses confusion about categorisations

HOW TO OFFER:
Include this exact CTA block (replace N with the count):
[CTA:value_map_retake]Retake (${decision.low_confidence_count} transactions)[/CTA]

RULES:
- Maximum once per conversation. If the user declines, don't re-offer.
- Never immediately after an upload.
- Don't lecture about accuracy — just "Want to sharpen this?"
- The retake takes 2 minutes.`
  } catch {
    return ''
  }
}

async function getPredictionQualityContext(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<string> {
  try {
    const { getPredictionMetrics } = await import('@/lib/prediction/metrics')
    const metrics = await getPredictionMetrics(supabase, userId)
    if (metrics.total_transactions < 20) return ''

    const predicted = metrics.confirmed_count + metrics.predicted_count
    const predictedPct = metrics.total_transactions > 0
      ? Math.round((predicted / metrics.total_transactions) * 100)
      : 0

    return `## Prediction quality (how confident is the CFO's categorisation?)

- ${predictedPct}% of transactions are confidently categorised (${predicted} of ${metrics.total_transactions})
- Average confidence: ${metrics.avg_confidence}
- Merchants the CFO has learned rules for: ${metrics.merchants_learned}
- Low-confidence transactions: ${metrics.low_confidence_pct}% of the total

USE THIS AS A TRUST CALIBRATOR:
- If low_confidence_pct is high (>30%), be more tentative when referencing value categories.
- When you reference a specific transaction's value category, you can implicitly rely on this quality score.
- If the user challenges a categorisation, acknowledge the uncertainty openly.`
  } catch {
    return ''
  }
}

async function getValueMappingContext(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<string> {
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('value_confirmed_by_user, value_confidence')
      .eq('user_id', userId)
      .lt('amount', 0)

    if (error || !data || data.length === 0) return ''

    const total = data.length
    const unreviewed = data.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (t: any) =>
        !t.value_confirmed_by_user &&
        (t.value_confidence === null || Number(t.value_confidence) < 0.7)
    ).length
    const reviewed = total - unreviewed
    const percentReviewed = Math.round((reviewed / total) * 100)

    if (unreviewed < 10) return ''
    if (percentReviewed > 70) return ''

    return `## Understanding this user's values

${unreviewed} of ${total} expense transactions haven't been value-classified yet (${percentReviewed}% confirmed).

The user's spending tells a story, but you need THEM to tell you what it means.
The same transaction can be different values in different contexts — a Friday night
grocery run might be a Leak (didn't plan meals) while a Saturday morning shop is Foundation.

TWO WAYS TO LEARN THIS — PICK THE RIGHT ONE:

**1. Batch check-in (PREFERRED when the user asks for one, or when you want to offer one).**
If the user says "value check-in", "check-in", "Value Map", "let me classify", or any variant —
OR you decide to proactively offer a batch session — use check_value_checkin_ready and emit a
[CTA:value_checkin] block. The user swipes through 5-15 cards in a dedicated UI. You do NOT
classify anything in chat in this flow. You do NOT call record_value_classifications — the
check-in endpoint saves everything server-side. After they finish, you'll receive a system
message summarising what they classified; acknowledge briefly and move on.

**2. Inline curiosity (for mid-conversation moments only).**
When a spending topic comes up naturally — e.g. the user mentions dining out, or you spot
an interesting merchant pattern — you can use get_value_review_queue to fetch ONE merchant
group and ask about it conversationally: "[merchant] shows up a few times in your data.
Are those all the same kind of spend, or do some feel different?" Present one group at a
time with 2-3 specific examples. After they answer, you MUST call record_value_classifications
to persist the decision — never say "Saved", "Got it", or "will remember" without calling
the tool. Include context_note when the user explains their reasoning. STOP after 2 groups
per conversation.

CRITICAL: NEVER mix the two flows. If the user asked for a "check-in" you emit the CTA and
stop — do NOT also start classifying inline. The inline flow is reserved for moments you
wove in naturally, not for requests that contain the word "check-in" or similar.

Never present either flow immediately after upload — let the first spending insight land first.`
  } catch {
    return ''
  }
}

async function getConversationInstructions(
  conversationType?: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any> | null,
  userId?: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  snapshots?: any[] | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile?: any
): Promise<string> {
  const firstName = (profile?.display_name as string | undefined)?.trim() || null;
  const nameAddress = firstName ? firstName : 'them';

  switch (conversationType) {
    case 'onboarding':
      return `## Conversation context: First meeting

This person just completed the Value Map (a SAMPLE perception exercise) and signed up. Their archetype and value perceptions are in your context above. You have ZERO real spending data on them yet.
${firstName ? `Their first name is **${firstName}** — address them by name in the opening line.` : ''}

Your opening message must:
1. Open with the single most striking observation about how they classified the sample. Do not greet, welcome, or introduce yourself — they know who you are. ${firstName ? `Use the name "${firstName}" naturally mid-sentence if it fits, otherwise skip it.` : ''} Professional and direct, like walking into the CFO's office.
2. Reference ONE perception naturally — e.g. "You sorted dining out as a burden — that's where the friction sits." Frame it as observation about their classification, not characterology.
3. Pivot immediately to: ask them to upload a recent bank statement (CSV or screenshot) to see what's actually going on with their money. Include this exact markdown link: [Upload your transactions](/transactions). NEVER use /upload — that path does not exist.
4. Stay under 4 sentences total. No question-stack, no feature tour.
5. Sign off "— C." on its own line (first message of the session).

HARD RULES:
- Quote NO percentages from the Value Map — those reflect sample classifications, not real spending.
- Never say "your spending is X%" or "X% of your money goes to Y". You don't have that data.
- Use "you see...", "you categorised...", "you called..." phrasing — never "your spending is...".
- Do NOT explain what the Value Map was, that it used sample data, or how it works.
- Pick the SINGLE most interesting perception. Don't list two or three findings.
- UPLOAD LINK: always use [Upload your transactions](/transactions). Never /upload, never /dashboard, never /chat.`;

    case 'onboarding_no_vm':
      return `## Conversation context: Onboarding (no Value Map)

${firstName ? `Their first name is **${firstName}** — open with their name.` : ''}
This user signed up directly without completing the Value Map.

Your opening message must:
1. Open with the upload pitch directly — no greeting, no welcome, no introduction. ${`Use ${nameAddress} only if it fits naturally mid-sentence.`} Professional and direct, like walking into the CFO's office.
2. Pivot directly to upload: "Upload a recent bank statement and your CFO can show what's actually going on with your money." Include this exact markdown link: [Upload your transactions](/transactions). NEVER use /upload — that path does not exist.
3. Optionally mention the Value Map as a 2-minute side door if they'd prefer to start there: [Try the Value Map](/demo).
4. Max 3 sentences total. No feature tour, no question-stack.
5. Sign off "— C." on its own line (first message of the session).`;

    case 'monthly_review':
      return buildMonthlyReviewPrompt(metadata, userId);

    case 'trip_planning':
      return `## Conversation type: Trip planning

Help the user plan and budget for a trip. Follow this flow:

STEP 1 — COLLECT (1-2 exchanges):
Ask about: destination, approximate dates, duration, who's going, travel style (budget/mid-range/luxury).
If they mention a partner, ask if they'll split costs 50/50.
Keep it conversational — don't dump all questions at once.

STEP 2 — RESEARCH (use web search if available):
Estimate current prices for:
- Flights from their location to destination (use real airlines where possible)
- Accommodation ranges for their travel style
- Average daily food costs at destination
- Key activities/experiences and their costs
- Local transport costs
Be specific with real price ranges and practical tips.

STEP 3 — BUDGET (call plan_event tool):
Once you have cost estimates, call the plan_event tool with your estimates and kind: 'travel'.
Present the results conversationally:
- Total budget with per-category breakdown
- Their share (if splitting)
- Funding plan: "If you save €X/month for Y months..."
- Feasibility assessment based on their actual cash flow
- If tight: suggest specific categories where they could cut back, with amounts

STEP 4 — REFINE:
Let the user adjust. They might say "that's too much for accommodation" or "we'll definitely do X activity."
Update the budget accordingly (call plan_event again with revised estimates if significant changes).

STEP 5 — COMMIT:
Confirm the plan is saved as a goal. Let them know they'll see progress on the dashboard.
If relevant, create action items: "Book flights when prices drop below €X", "Set up a trip savings pot", etc.

IMPORTANT:
- All calculations come from the plan_event tool, not from your head.
- Reference their actual surplus/discretionary spending when discussing feasibility.
- If experiences rank high in their values, acknowledge that this trip aligns with their values.
- If the trip is expensive but important, find a way to make the numbers work. Only flag "unrealistic" when the numbers genuinely don't work.`;

    case 'scenario':
      return `## Conversation context: Scenario modelling

The user wants to explore a what-if. Use the model_scenario tool to run the numbers — never calculate yourself.

Available scenario types:
- **salary_increase**: new income or percentage increase
- **expense_reduction**: cut a specific spending category by a percentage
- **property_purchase**: mortgage calculator with deposit, rate, and term
- **children**: cost of having kids — childcare, food, clothing, activities
- **career_change**: transition costs, runway analysis, new income comparison
- **investment_growth**: compound growth projections with year-by-year breakdown

Ask enough to fill the required params, then call model_scenario. Present the numbers clearly, then give your honest take on whether it makes sense given their situation. Always mention the impact on their active goals if any exist.`;

    case 'first_read':
    case 'post_upload': {
      const payload = metadata?.first_insight_payload as InsightPayload | undefined;
      if (!payload) {
        // Legacy fallback: rows without a payload (pre-First-Insight-Engine
        // conversations) still render using the original post-upload prompt.
        return buildPostUploadPrompt(metadata, snapshots, profile);
      }
      return `## Conversation type: First insight

This is your first real conversation with this user after they uploaded transactions.
${payload.hasValueMap ? 'They have completed the Value Map.' : 'They have NOT done the Value Map.'}

Your goals:
1. Open with "Right." — you've done the reading, now you're giving your take.
2. Narrate ONLY the patterns in the First Insight Data section above.
3. Use actual numbers from the data. Never round aggressively (€1,935 not "about €2,000").
4. Deliver each layer as a separate thought — the frontend renders these as separate chat bubbles.
5. Emit the [STATS]...[/STATS] block exactly once, between the numbers layer and the hidden_pattern layer.
6. End with the hook, then an [OPTIONS]...[/OPTIONS] block with the three suggested responses.

Structure: headline → gap (or spending shape if no VM) → numbers + [STATS] → hidden pattern → one action → hook → [OPTIONS]

Tone:
- Direct, honest, not preachy.
- Observe and interpret — don't lecture.
- If discipline score > 70: lead with recognition; partner tone.
- Name patterns without judgement ("you shop at 22 stores" not "too many stores").
- The action must be specific and quantified where possible.

CRITICAL: Do not mention, reference, imply, or compute anything involving income, savings rate, surplus, affordability, or sustainability. You do not have this data. The hook creates the desire to share income — but you must not pretend you already have it.`;
    }

    case 'value_map_complete':
      return buildValueMapCompletePrompt(metadata, snapshots, profile);

    case 'bill_optimisation':
      return buildBillOptimisationPrompt(metadata, userId);

    case 'chip_opener':
      return `## Conversation type: First chat after onboarding

The user just completed the Value Map and uploaded transactions. Their first message is from a tappable chip — respond to it directly.

- "Show me where my money's going." → Call get_spending_summary for the most recent month, lead with the single most surprising finding. One paragraph. Then ask one specific follow-up.
- "Help me sort out my monthly bills." → Surface what they're paying for recurring expenses, ask which one they'd most like to reduce.
- "I'd like to add another account or card..." → Don't call tools. Explain how to upload, what formats are accepted, what extra value they'll unlock. Three sentences.
- "I want to plan a trip I've been putting off..." → Don't call tools yet. Ask three questions: where, when, and approximate budget.

For any other opening, follow normal conversation instructions.
Keep the first response focused — one insight or one question. No lists, no feature tours. The user has already had their Read — don't re-state the standing numbers (income, free cash flow, goal math); build on them toward the one thing they tapped for. Leave them wanting the next turn.`;

    default: {
      // Check if this conversation was initiated from a nudge
      const nudgeType = metadata?.nudge_type as string | undefined;
      if (nudgeType) {
        return buildNudgeContext(nudgeType, metadata ?? {});
      }

      return `## Conversation context: General

Open conversation. Follow their lead — answer what they actually asked. Don't pivot to what you think they should be asking. If there's something urgent in their data, mention it once at the end. Keep it natural.

Continuity: the user has already had their Read — income, fixed costs, free cash flow, the goal math, and where their spend concentrates are established facts they've already seen, not fresh findings. Don't re-deliver them as if new; reference them in a clause and build forward. Extend the picture, don't restate it. Land the turn on one clear thing they can act on — not a recap, not a housekeeping list.

If the Experiments section below shows an outcome owed (an experiment whose end date has passed without a self-report), open this turn with the check-in instead — do not greet, do not summarise, ask how it went.`;
    }
  }
}

function buildNudgeContext(nudgeType: string, params: Record<string, unknown>): string {
  switch (nudgeType) {
    case 'payday_savings':
      return `## Conversation trigger: Payday detected
The user just received their salary. This is a good moment to discuss:
1. Transferring a portion to savings (suggest their savings rate target if set)
2. Any upcoming bills or large expenses this month
3. Progress on active goals
Be proactive but not pushy. They tapped the reminder, so they're open to the conversation.`;

    case 'budget_alert':
      return `## Conversation trigger: Budget alert
The user's ${params.category ?? 'spending'} is approaching or has exceeded their budget.
Use the get_spending_summary tool to get the exact numbers. Show them:
1. Current spend vs budget for this category
2. What's driving the overspend (largest transactions)
3. Practical suggestions for the rest of the month
Don't lecture. Acknowledge and help.`;

    case 'contract_expiry':
      return `## Conversation trigger: Contract expiry
The user's ${params.provider ?? 'provider'} contract is expiring soon.
Use the search_bill_alternatives tool to research current alternatives.
Present options clearly with potential savings. Help them decide and create an action item.`;

    case 'spending_spike':
      return `## Conversation trigger: Spending spike
Unusual spending detected in ${params.category ?? 'a category'}.
Pull the data with get_spending_summary, then:
1. Show the spike compared to their average
2. Ask if it's a one-off or a pattern
3. If it's travel/holiday related, suggest tagging those transactions
Don't be alarming. It might be perfectly intentional.`;

    case 'action_reminder':
      return `## Conversation trigger: Action item reminder
The user has a pending action item. Retrieve it with get_action_items.
Help them either complete it, break it into smaller steps, or reschedule it.
If they've been nudged multiple times about this item, be understanding — maybe the task needs to be reframed or isn't relevant anymore.`;

    case 'upload_reminder':
      return `## Conversation trigger: Upload reminder
It's been a while since the user uploaded transaction data.
Gently remind them that fresh data sharpens the guidance.
Offer to walk them through an upload if they have their statement ready.`;

    default:
      return '';
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildMonthlyReviewPrompt(metadata: Record<string, any> | null | undefined, userId?: string): Promise<string> {
  const reviewMonth = metadata?.review_month as string | undefined
  if (!reviewMonth || !userId) {
    return `## Conversation context: Monthly review

Walk the user through their month. Start with the headline number (surplus or deficit), then drill into what changed. Compare to last month. Highlight any value category shifts. End with 1-2 specific action items.`
  }

  const reviewContext = await assembleReviewContext(userId, reviewMonth)

  return `## Conversation context: Monthly Review

${reviewContext}

---

### YOUR APPROACH — deliver this as a conversation, not a report

**Phase 1 — The Headline**
Open with the single most important number: surplus or deficit. Frame it relative to last month if comparison data is available. One clear sentence that sets the tone — is this a celebration, a course correction, or business as usual?

Then STOP. Wait for the user to respond before continuing.

**Phase 2 — Wins & Concerns**
Highlight the biggest positive change and the biggest concern from the comparison data. Be specific — name the category, the amount, the trend. If a category improved, acknowledge what the user did differently. If something worsened, name it without drama.

Then STOP. Let the user react or ask questions.

**Phase 3 — Value Shifts** (skip if no shifts detected or single-month review)
This is the most important part. Walk through the value category shifts:
- Name the traditional category that shifted
- Explain what the shift means in plain language
- Reference the specific transactions that drove it
- Connect it to the user's stated values if you know their Value Map archetype

If there are no significant shifts, acknowledge consistency briefly — that's worth noting.

Then STOP. Ask if the shift matches how they feel about that spending.

**Phase 4 — Goal Check-in** (skip if no active goals)
Brief progress check on each active goal. Use the actual numbers from the review data. If a goal is off track, state the fact and what needs to change — don't lecture. If on track, acknowledge it in one line.

**Phase 5 — Actions**
1. Review previous action items: acknowledge completions, ask about pending ones
2. Based on this review's findings, suggest 1-2 new action items
3. Confirm with the user before creating them via the create_action_item tool
4. Close with a forward-looking statement about next month

### RULES:
- Every number you present MUST come from the review data above. Never calculate yourself.
- Do NOT present all phases in a single message. This is a CONVERSATION — pause after each phase.
- If the user interrupts to ask about something specific, answer it, then return to the flow.
- Be direct. If spending is concerning, say so. If they're doing well, acknowledge it briefly — no celebration, no gamification.
- Reference their Value Map archetype or financial portrait traits when relevant — don't list them.
- Maximum 2 new action items suggested. Always confirm before creating.
- Use [OPTIONS]...[/OPTIONS] tags for tappable follow-up suggestions where appropriate.
- The entire review should be completable in 5-8 exchanges. Don't drag it out.`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildValueMapCompletePrompt(metadata: Record<string, any> | null | undefined, snapshots: any[] | null | undefined, profile: any): string {
  const gapResult = metadata?.gap_analysis
  const currency = profile?.primary_currency || 'EUR'
  const latest = snapshots?.[0]
  const monthCount = snapshots?.length ?? 0

  let prompt = `## Conversation type: Value Map Complete

The user has just finished the Value Map exercise. They now have both transaction data AND stated value preferences — this unlocks The Gap analysis.

Deliver an immediate update based on the comparison between what they said they value and what their spending shows. This is the most powerful moment in the product — don't waste it.

`

  if (monthCount > 0 && latest) {
    prompt += `### Transaction data available: ${monthCount} month${monthCount > 1 ? 's' : ''}
Latest month (${latest.month}): ${currency} ${latest.total_spending} total spending
`
  }

  if (gapResult?.has_value_map && gapResult?.gaps?.length > 0) {
    prompt += `
### THE GAP — Value Map vs Reality

${gapResult.gaps.map((gap: Record<string, unknown>) => `**${gap.category}:**
- They said: "${gap.stated_value_category}" (confidence: ${gap.stated_confidence}/1.0)
- Reality: ${currency} ${gap.actual_monthly_spend}/month (${gap.pct_of_total_spending}% of total)
- Gap type: ${gap.gap_type} (${gap.gap_severity} severity)
- Narrative: ${gap.narrative}`).join('\n\n')}

Summary: ${gapResult.summary.aligned_count} aligned, ${gapResult.summary.gap_count} gaps. Estimated monthly leak: ${currency} ${gapResult.summary.estimated_monthly_leak}.

### YOUR APPROACH:

1. **Acknowledge the Value Map completion** — briefly, one sentence. Don't dwell.
2. **Lead with The Gap** — pick the single most striking discrepancy and name it directly.
   Example: "Your biggest gap is dining. You called it a Leak — and the data confirms it, at £240/month, 18% of your spending."
3. **Show what's aligned** — name one or two categories where their values match reality. This builds trust.
4. **Ask ONE question** — about the most interesting gap. Make it tappable.
5. **Close with a forward-looking statement** — "Each month sharpens this picture. Sign off — C."

TONE: This is a reveal moment. Be direct, specific, and grounded in their actual numbers. Don't qualify everything — say what the data says.
`
  } else if (monthCount > 0) {
    prompt += `
### No significant gaps found — all categories are aligned (or nearly so).

### YOUR APPROACH:

1. **Acknowledge the Value Map completion** — briefly.
2. **Deliver the good news** — their spending largely matches what they said they value.
3. **Show them one highlight** — which category has the strongest alignment.
4. **Introduce a gentle challenge** — "Everything looks aligned. The question is whether your current spending level on [biggest category] feels sustainable long-term." Use tappable options.

TONE: Validating but curious. Aligned spending doesn't mean optimal spending.
`
  } else {
    prompt += `
### No transaction data yet.

Tell the user their Value Map results are saved, but to unlock the full Gap analysis they need to upload a bank statement. Keep it brief and encouraging. Link to the upload flow.

TONE: Warm and encouraging. The Value Map was valuable — uploading completes the picture.
`
  }

  prompt += `
### RULES:
- Lead with the insight. Your FIRST message is the reveal — make it count.
- Use only system-provided numbers. Never calculate yourself.
- Max 2 follow-up questions in total. Use [OPTIONS]...[/OPTIONS] format.
- If the user corrects a value category, call update_value_category.
`

  return prompt
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPostUploadPrompt(metadata: Record<string, any> | null | undefined, snapshots: any[] | null | undefined, profile: any): string {
  const gapResult = metadata?.gap_analysis
  const txCount = metadata?.transaction_count || 0
  const currency = profile?.primary_currency || 'EUR'
  const latest = snapshots?.[0]

  const monthCount = snapshots?.length ?? 1
  let prompt = `## Conversation type: Post-Upload Insight

You've just received this user's bank transactions (${txCount} transactions across ${monthCount} month${monthCount > 1 ? 's' : ''}).
Your job is to deliver a powerful first impression — make them feel understood, not judged.

### The data you have:
`

  // Spending snapshot
  if (latest) {
    const vcBreakdown = latest.spending_by_value_category as Record<string, number> | null
    const vcTotal = vcBreakdown ? Object.values(vcBreakdown).reduce((s, v) => s + v, 0) : 0

    prompt += `
Latest month (${latest.month}):
- Total spending: ${currency} ${latest.total_spending}
- Transaction count: ${latest.transaction_count}
- Largest transaction: ${currency} ${latest.largest_transaction}${latest.largest_transaction_desc ? ` (${latest.largest_transaction_desc})` : ''}
`

    if (vcBreakdown && vcTotal > 0) {
      const pct = (k: string) => (((vcBreakdown[k] ?? 0) / vcTotal) * 100).toFixed(1)
      prompt += `
Value category breakdown:
- Foundation: ${pct('foundation')}%
- Investment: ${pct('investment')}%
- Burden: ${pct('burden')}%
- Leak: ${pct('leak')}%
- Unsure/untagged: ${pct('unsure')}%
`
    }
  }

  // Historical months context
  if (snapshots && snapshots.length > 1) {
    prompt += `\nPrevious months (for trend context):\n`
    for (const snap of snapshots.slice(1)) {
      prompt += `- ${snap.month}: ${currency} ${snap.total_spending} spending\n`
    }
  }

  // PATH A: The Gap (Value Map completed and gaps found)
  if (gapResult?.has_value_map && gapResult?.gaps?.length > 0) {
    prompt += `
### THE GAP — Value Map vs Reality

This user completed the Value Map before uploading. Here is the comparison between what they SAID they value and what their spending SHOWS:
`
    for (const gap of gapResult.gaps) {
      prompt += `
**${gap.category}:**
- Value Map said: "${gap.stated_value_category}" (confidence: ${gap.stated_confidence}/1.0)
- Actual spend: ${currency} ${gap.actual_monthly_spend}/month (${gap.pct_of_total_spending}% of total)
- Gap type: ${gap.gap_type}
- Gap severity: ${gap.gap_severity}
- System narrative: ${gap.narrative}
`
    }

    prompt += `
Summary: ${gapResult.summary.aligned_count} aligned categories, ${gapResult.summary.gap_count} gaps found.
Estimated monthly leak: ${currency} ${gapResult.summary.estimated_monthly_leak}.
Biggest gap: ${gapResult.summary.biggest_gap_category} (${gapResult.summary.biggest_gap_type}).

### YOUR APPROACH (Path A — The Gap):

Your FIRST message MUST explicitly name "the gap" (or "the gap between what you said and what your money shows") AND quote at least one exact € figure from the data above. Never summarise abstractly. If you don't use the word "gap" and at least one precise € figure in the opening message, you have failed this conversation.

Structure — all four in the first message, in order:

1. **Name the gap, lead with a number** — Quote the biggest gap with the exact monthly €. Example: "Here's the gap between what you said you value and what your money actually does: ${gapResult.summary.biggest_gap_category || 'dining'} was sorted as a Leak, and it's still costing roughly ${currency} X a month."

2. **Show the concrete money-saving action** — Translate that leak into a specific €/month they could keep in their pocket THIS MONTH if they acted. Example: "Cutting that in half is ~${currency} Y/month — about ${currency} Z a year — redirected somewhere that actually feels like yours." Be specific with numbers pulled from the data above. No vague "consider spending less" language.

3. **Acknowledge one alignment briefly** — one sentence, no more. "Your [category] spend is lined up with what you said — keep that."

4. **Ask ONE follow-up** — tappable options. End with [OPTIONS] block, e.g. "Show where else the money is leaking", "Set a cap on [category]", "Something else".

5. Sign off "— C." on its own line — this is a meaningful finding.

HARD RULES:
- The word "gap" MUST appear in the first paragraph.
- At least ONE exact € figure from the data above MUST appear in the first paragraph (not a range, not a round number you invented).
- The concrete €-per-month saving action MUST appear before any follow-up question.
- Never say "you should spend less on X" — instead say "if you redirected X, you'd keep €Y".
- Phrasing: observational, not characterological. "The data shows…", "The gap between knowing and doing…". Mirror, not scorecard.
`
  }
  // PATH B: No Value Map or no gaps
  else {
    prompt += `
### YOUR APPROACH (Path B — No Gap data):

This user ${gapResult?.has_value_map ? 'has a Value Map but no significant gaps were detected' : 'uploaded bank data WITHOUT completing the Value Map first'}. You don't have Gap data, but you DO have their value category breakdown and spending figures above. Your job is still to deliver a concrete money-saving insight in the first message.

Your FIRST message MUST include at least one exact € figure from the data above AND one concrete action the user could take this month to keep more money. Abstract "watch your subscriptions" framing is a failure.

Structure — all four in the first message, in order:

1. **Lead with the headline number** — the biggest leak-tagged spending in €/month, or the biggest recurring charge, or the largest single transaction. Quote the exact figure. Example: "Last month, ${currency} X of your spending landed in the Leak bucket — Y% of everything you spent."

2. **Concrete money-saving action** — pick the biggest leak or most-duplicated spend and give a specific €/month redirect. Example: "The biggest chunk is [merchant/category] at ~${currency} Z/month. Trim that by a third and you'd keep ${currency} W this month, roughly ${currency} W×12 a year."

3. **One sentence on what's working** — brief acknowledgement of whatever looks aligned.

4. **Ask ONE follow-up with tappable options** — end with [OPTIONS] block, e.g. "Dig into that leak", "Show the full breakdown", "Something else".

5. Sign off "— C." on its own line — this is a meaningful finding.

HARD RULES:
- At least ONE exact € figure from the data above MUST appear in the first paragraph.
- The concrete €-per-month saving MUST appear before any follow-up question.
- Do NOT suggest the Value Map — the user has already seen it (or chose not to).
- Never say "you should spend less on X" — instead say "if you redirected X, you'd keep €Y".
`
  }

  // Common rules for both paths
  const firstName = (profile?.display_name as string | undefined)?.trim() || null
  const completeness = Number(profile?.profile_completeness ?? 0)
  const addressName = firstName ?? 'them'

  prompt += `
### USE COUNTRY BENCHMARKS IN THE FIRST INSIGHT

If the "Country benchmarks" section exists in your context above, you MUST anchor at least one figure in the first insight against a benchmark from that section.
- Phrasing: "You spent €341 on groceries last month. The typical Spanish household spends about €280 — you're running a bit hot."
- Use "typical for [country]" / "average household" — NEVER "normal".
- ONE benchmark comparison per insight, not a list.
- Only reference categories that actually exist in the benchmarks section. Do not invent numbers.
- If no benchmarks section exists (no rows for this user's country), fall back to internal comparisons (their own historical months, their value breakdown) — do not mention benchmarks at all.

### RULES FOR THIS CONVERSATION:

- Lead with the insight. Your FIRST message should contain the aha moment — don't ask "how can I help" or wait for them to speak.
- Keep numbers precise — use the system-provided figures, never calculate yourself.
- Maximum 3 follow-up questions in this entire conversation. Each should be tappable.

Format tappable options like this:

[OPTIONS]
- Option one
- Option two
- Option three
[/OPTIONS]

- If the user corrects a value category (e.g. "actually, dining IS an investment for me"), acknowledge it warmly and call the update_value_category tool.
- Save any profile data you learn via the update_user_profile tool.
- End the conversation naturally — "Your CFO keeps watching as more data comes in" is a good close.

### PHASE 2 — PROFILING OPT-IN (after the first insight lands)

Once you've delivered the first insight and the user has reacted (any response), transition to profiling. Be EXPLICIT about why. Use roughly this framing, in your own words:

"${addressName}, to sharpen the guidance from generic to actually useful, a few questions about your situation will be needed over time. Right now your CFO profile is at about ${completeness}% — enough to spot patterns, not enough for a real strategy. Fill in a few basics now, or do it as we go?"

If they agree (any affirmative — "sure", "go ahead", "let's do it", "let's do a few now", "yes", "ok"):
- IMMEDIATELY call request_structured_input. Do NOT output any text before the tool call — the form renders inline and contains its own label/rationale. No preamble like "Great. First one:" — just call the tool.
- Ask up to 3 questions, ONE at a time:
  1. field: "net_monthly_income", input_type: "currency_amount", label: "What's your monthly take-home pay?", rationale: "Needed to tell whether the spending patterns are sustainable"
  2. field: "housing_type", input_type: "single_select", options: [Renting, Mortgage, Own outright, Living with family], label: "What's your housing situation?", rationale: "Housing is usually the biggest lever — needed for meaningful benchmarks"
  3. field: "monthly_rent", input_type: "currency_amount", label: "How much do you pay per month?", rationale: "Compared against typical costs for your area" — ONLY ask if housing_type ∈ {Renting, Mortgage}
- After each answer is submitted, give a one-line acknowledgement. If a country benchmark for that field exists in your context, reference it without inventing numbers — never quote a figure that isn't in the user's data or the benchmark fields you've been given.
- Confirm before moving on by quoting the value the user just submitted (e.g. "Noted — sound right?"). Then call the next tool immediately.

If they defer ("over time" / "later" / "not now"):
- Respect it. Do NOT push further in this conversation. The profiling engine picks up future questions across sessions.
- Say something like: "No problem — they'll come up naturally as we talk."

HARD LIMITS:
- Max 3 profiling questions on Day 0 even if the user is enthusiastic.
- No goals, investments, or life-plan questions on Day 0.
- Never ask all three at once. Always one at a time via request_structured_input.
- If the user volunteers the answer in free text before you call the tool (e.g. "i am 27", "rent is €1,200"), skip the tool for that field entirely. Acknowledge, save via update_user_profile, and move on to the next question.
- Close warmly: "Solid start${firstName ? `, ${firstName}` : ''}. Your dashboard has the full breakdown when you want to explore."
`

  return prompt
}

async function buildBillOptimisationPrompt(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any> | null | undefined,
  userId?: string
): Promise<string> {
  if (!metadata?.bill_id || !userId) {
    return `## Conversation context: Bill Optimisation

Help the user optimise their bills. Ask which bill they'd like to review, then use search_bill_alternatives to research better deals.`
  }

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()

  const { data: bill } = await supabase
    .from('recurring_expenses')
    .select('*')
    .eq('id', metadata.bill_id)
    .eq('user_id', userId)
    .single()

  if (!bill) {
    return `## Conversation context: Bill Optimisation

The referenced bill could not be found. Ask the user which bill they'd like to review.`
  }

  const { normaliseToMonthly } = await import('@/lib/bills/normalise')
  const monthlyAmount = normaliseToMonthly(Number(bill.amount), bill.frequency || 'monthly')
  const planDetails = bill.current_plan_details as Record<string, unknown> | null

  let prompt = `## Conversation context: Bill Optimisation

You are reviewing the user's ${bill.provider || bill.name} bill.

Current details:
- Provider: ${bill.provider || 'Unknown'}
- Amount: ${bill.currency || 'EUR'} ${bill.amount} per ${bill.frequency || 'month'}
- Monthly equivalent: ${bill.currency || 'EUR'} ${monthlyAmount.toFixed(2)}`

  if (planDetails) {
    const detailParts: string[] = []
    if (planDetails.tariff_type) detailParts.push(`Tariff: ${planDetails.tariff_type}`)
    if (planDetails.power_contracted_kw) detailParts.push(`Contracted power: ${planDetails.power_contracted_kw} kW`)
    if (planDetails.consumption_kwh) detailParts.push(`Last consumption: ${planDetails.consumption_kwh} kWh`)
    if (planDetails.consumption_m3) detailParts.push(`Last consumption: ${planDetails.consumption_m3} m³`)
    if (planDetails.plan_name) detailParts.push(`Plan: ${planDetails.plan_name}`)
    if (planDetails.speed_mbps) detailParts.push(`Speed: ${planDetails.speed_mbps} Mbps`)
    if (planDetails.data_gb) detailParts.push(`Data: ${planDetails.data_gb} GB`)
    if (detailParts.length > 0) prompt += `\n- Plan details: ${detailParts.join(' \u00B7 ')}`
  } else {
    prompt += `\n- No plan details uploaded yet`
  }

  if (bill.contract_end_date) {
    prompt += `\n- Contract ends: ${bill.contract_end_date}`
  } else {
    prompt += `\n- No contract end date known`
  }

  prompt += `\n- Permanencia: ${bill.has_permanencia ? 'Yes \u2014 check before switching!' : 'No'}`

  if (bill.potential_saving_monthly) {
    prompt += `\n- Previously researched saving: ${bill.currency || 'EUR'} ${bill.potential_saving_monthly}/month`
  }

  prompt += `

Your approach:
1. If plan details are missing, ask the user to upload their latest bill from the /bills page or provide key details (tariff type, consumption, contracted power).
2. If plan details exist, summarise what you know and ask if the user wants you to research alternatives.
3. When researching, call the search_bill_alternatives tool with all available details.
4. Present alternatives clearly with pros/cons. Be specific about potential savings.
5. If recommending a switch, create an action item with specific steps.

Spanish utility notes:
- Electricity: Ask about tariff type (PVPC regulated vs mercado libre). PVPC prices change hourly. Mercado libre offers fixed rates.
- Gas: Often bimonthly in Spain. Check if they heat with gas or just cooking/hot water.
- Internet: Digi uses the Movistar network for fibra. Check building infrastructure.
- Insurance: Sanitas/Adeslas are the main private health insurers. Annual renewal standard. Age-based pricing.
- Water: Usually municipal monopoly. Don't waste time researching alternatives.
- NEVER recommend switching if permanencia hasn't expired.`

  return prompt
}
