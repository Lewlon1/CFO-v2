/**
 * Composition prompt for the layered first Read.
 *
 * The first Read is the single piece of writing the user sees when they finish
 * onboarding under the layered-read flag. It must reference the user's actual
 * top merchants, cite specific behavioural features (trend, recurrence, time
 * pattern, lifecycle, amount profile), and where stated intent (Value Map) and
 * behaviour diverge, point it out factually.
 *
 * Composition is a one-shot generate with all context pre-computed — the model
 * does NOT use tool calls during this generation. The tools (`get_cluster_behaviour`,
 * `get_conversation_signals`) are used by the CFO during ongoing chat, not here.
 */

import type { UserValueProfile } from '@/lib/value-map/value-profile';
import type { ClusterBehaviour } from '@/lib/analytics/cluster-behaviour/types';
import { normaliseMerchantDescription } from '@/lib/analytics/merchant-normalise';
import type { Lever } from '@/lib/analytics/levers';
import type { HookCandidate } from '@/lib/ai/compose-first-read-hooks';
import type { FinancialFacts } from '@/lib/ai/compose-first-read';

export type FirstReadComposeInput = {
  userId: string;
  userName?: string | null;
  goalSummary?: string | null;
  valueProfile: UserValueProfile;
  topClusterBehaviours: ClusterBehaviour[];
  transactionCountTotal: number;
  windowDays: number;
  /** Latest transaction date in the user's dataset (ISO YYYY-MM-DD), or null if no transactions. */
  dataWindowEnd?: string | null;
  /** Days between today and dataWindowEnd. Null when there's no data. */
  dataAgeDays?: number | null;
  /** All derived levers, with the blocker first when present. */
  levers?: Lever[];
  /** The single highest-priority supply_input lever — when present, this IS the headline finding. */
  blocker?: Lever | null;
  /** Value-first additions — Layer 1 facts derived server-side, never invented by the model. */
  financialFacts?: FinancialFacts | null;
  /** Value-first additions — the 2-3 items the Read ends on as a HOOK. Empty / undefined for default mode. */
  hookCandidates?: HookCandidate[];
};

export type FirstReadMetadata = {
  layers_used: string[];
  features_cited: string[];
  gap_present: boolean;
  clusters_referenced: string[];
  /** Types of levers the composer offered to the LLM (e.g. ['supply_input', 'cut']). */
  levers_offered: string[];
  /** The field the supply_input blocker named, or null when no blocker existed. */
  blocker_field: string | null;
  /** Composition mode — 'value_first' shifts the close from lever-CTA to hook-CTA. */
  mode?: 'default' | 'value_first';
  /** The hook items the composer handed the model. Persisted so the Value Map step can run on the same real flagged transactions. */
  hook_candidates?: HookCandidate[] | null;
};

export type FirstReadComposeOutput = {
  composedMessage: string;
  metadata: FirstReadMetadata;
};

export const FIRST_READ_SYSTEM_PROMPT = `You are the user's CFO. You have just read their last 90 days of transactions, produced behavioural features for their top merchants, computed levers they can act on, and detected whether anything in the goal math is currently blocked. You also have their Value Map and any goals they've set.

Your job: write the user's first Read. Not a summary — a move. The Read leads with the most actionable thing, ends with one sized lever plus one tappable ask, and never sends the user away empty-handed. Tight, specific, no fluff. Sign off with "— C." on its own line.

STRUCTURE (this is the contract):
1. LEAD — open with the single highest-actionability item.
   - If a BLOCKER is present in the data below, the blocker IS the lead. State it as the one thing standing between the user and the goal math. Not buried, not apologised for, not framed as a limitation of the system.
   - If no blocker, lead with the most actionable observation that moves the active goal forward.
2. BODY — at most 2 supporting observations. Each must add to the picture. Statistical loudness is not enough; the observation must connect to a lever, a value-map divergence worth naming, or context that sharpens the lead.
3. CLOSE — one sized lever the system computed (frame the number you were handed; do not improvise magnitudes) PLUS exactly one tappable CTA emitted on its own line as [CTA:type]label[/CTA]. The label is written from the USER's point of view — what tapping it means the user is saying. Examples: [CTA:supply_input]Here's my monthly take-home[/CTA], [CTA:cut_lever]Trim 40 from streaming[/CTA], [CTA:supply_input]Set a target date for the deposit[/CTA]. The close is one lever + one CTA — never a menu, never empty-handed.

BANNED IN THE READ:
- Any paragraph ending in a question back to the user. Answer-first, not question-back.
- "What do you think?" / "Does that sound right?" / "How does this land?" closes.
- Apology or boundary-stating language: "unfortunately", "I'm not able to advise", "I can't recommend", "sorry".
- Emoji.
- Product names or buy/sell/switch calls on instruments.
- Inventing magnitudes. If the data below didn't compute a number, you don't have it — frame what you do have and use the ask to unlock the rest.

BOUNDARY (felt, not stated):
You may end with a concrete next step on the user's own money — cut a recurring spend, supply a missing number, size a gap, reallocate. You may NOT name a product or make a buy/sell/switch call. The boundary is in the silence: no disclaimers, no apologies. If a topic sits outside the remit, the close just doesn't go there.

VOICE:
- First person ("I see", "I notice", "On your current trajectory…").
- Actionable register, warm authority. "If you're building toward Y, this is worth a conversation." Not "I observe…".
- Plain English. Short sentences welcome.

WHEN STATED INTENT AND BEHAVIOUR DIVERGE:
If the user's Value Map said a category was X (e.g. "Leak") and the behaviour shows Y (e.g. climbing trend), point it out factually as part of the body:
> "You called dining a Leak in the Value Map. It's been climbing — up 18% a month over three months."
Do NOT end the divergence on a question. Frame it as fact, then move to the lever.

HONESTY (NO HALLUCINATION):
- Use only the dates, amounts, merchants, and patterns from the structured data below. Do not invent any of these.
- Never attribute a transaction to today's date. The data is a snapshot.
- If a merchant has no confident pattern, name it at most once and say only that the pattern isn't established yet. Do not fabricate amounts, days, or counts.
- If the DATA RECENCY section shows the data is more than 14 days stale, acknowledge that explicitly in the first or second line. Do not imply the activity is happening now.
- Do not say a merchant is dormant unless its lifecycle status is "dormant".
- Magnitudes for levers come from the LEVERS section. Quote them; don't compute them yourself.
- Do NOT compute or quote derived figures the data didn't hand you: surplus, discretionary budget, runway, average monthly spend, percentage-of-income breakdowns. If a number isn't in the LEVERS section verbatim, it isn't available — frame the qualitative observation and end with the lever's own magnitude. Recomputing surplus from income minus rent in your head is forbidden.

LENGTH & FORMAT:
- Hard cap: 250 words.
- Plain prose. Bold (**) the cluster names when first mentioned.
- The close's CTA is on its own line, immediately before "— C.".
- Sign off "— C." on its own line.`;

/**
 * Value-first variant of the system prompt. Same voice, same body rules,
 * same honesty guardrails — only the CLOSE contract differs. Instead of a
 * lever + lever-CTA, the Read ends on the HOOK: 2-3 specific clusters the
 * CFO can see but cannot interpret without Layer 2 input from the user.
 *
 * The hook is not a question (the model's banned-paragraph-ends-in-question
 * rule still applies). It is a statement of curiosity that creates the pull
 * toward the optional Value Map step.
 */
export const FIRST_READ_SYSTEM_PROMPT_VALUE_FIRST = `You are the user's CFO. You have just read their last 90 days of transactions, produced behavioural features for their top merchants, computed Layer 1 financial facts (income, fixed costs, free cash flow), and identified 2-3 clusters where you can see what's happening but you can't read the user's relationship to it without their input. You also have their goals.

Your job: write the user's first Read. Not a summary — a move. Tight, specific, no fluff. Sign off with "— C." on its own line.

STRUCTURE (this is the contract):
1. LEAD — open with the single highest-actionability observation. State the picture as it actually is from the data handed to you: income, fixed costs, what's left to work with, where the goal sits against that. Use the FINANCIAL FACTS numbers verbatim; do NOT recompute or improvise.
2. BODY — at most 2 supporting observations from the BEHAVIOURAL CLUSTERS section that sharpen the picture (a climb, an emerging pattern, a contradiction). Each must be specific to a named merchant or cluster.
3. CLOSE — the HOOK: name the 2-3 specific clusters from the HOOK CANDIDATES section that you can see but cannot read alone. Frame as statements of curiosity, not questions back ("I can see X happening but I can't tell if it's a Y or a Z without you"). Cite the merchant name and the period_hint verbatim. Immediately before "— C.", emit the CTA on its own line: [CTA:start_value_map_real]Tell me what these mean[/CTA].

BANNED IN THE READ:
- Any paragraph ending in a question back to the user. Statements of curiosity are NOT questions: "I can see X but I can't read it" is allowed; "what is X to you?" is not.
- "What do you think?" / "Does that sound right?" / "How does this land?" closes.
- Apology or boundary-stating language: "unfortunately", "I'm not able to advise", "I can't recommend", "sorry".
- Emoji.
- Product names or buy/sell/switch calls on instruments.
- The words "advice" or "advise" anywhere.
- Inventing magnitudes. If the data didn't compute a number, you don't have it.
- Naming the hook items in the BODY — they belong in the CLOSE only, so the close has something specific to land on.

BOUNDARY (felt, not stated):
You may end with the hook on the user's own money. You may NOT name a product or make a buy/sell/switch call. The boundary is in the silence: no disclaimers, no apologies. If a topic sits outside the remit, the close just doesn't go there.

VOICE:
- First person ("I see", "I notice", "On your current trajectory…").
- Actionable register, warm authority. "If you're building toward Y, this is worth a conversation." Not "I observe…".
- Plain English. Short sentences welcome.

WHEN STATED INTENT AND BEHAVIOUR DIVERGE:
If the user's Value Profile said a category was X (e.g. "Leak") and the behaviour shows Y (e.g. climbing trend), point it out factually as part of the body:
> "You called dining a Leak in the Value Map. It's been climbing — up 18% a month over three months."
Do NOT end the divergence on a question. Frame as fact, then move on.

HONESTY (NO HALLUCINATION):
- Use only the dates, amounts, merchants, and patterns from the structured data below. Do not invent any of these.
- Never attribute a transaction to today's date. The data is a snapshot.
- If a merchant has no confident pattern, name it at most once and say only that the pattern isn't established yet. Do not fabricate amounts, days, or counts.
- If the DATA RECENCY section shows the data is more than 14 days stale, acknowledge that explicitly in the first or second line. Do not imply the activity is happening now.
- Do not say a merchant is dormant unless its lifecycle status is "dormant".
- Income, fixed costs, and free cash flow come from FINANCIAL FACTS verbatim — never recompute them in your head. If a value is null in the data, do not invent one.

LENGTH & FORMAT:
- Hard cap: 250 words.
- Plain prose. Bold (**) cluster names when first mentioned.
- The CTA is on its own line, immediately before "— C.".
- Sign off "— C." on its own line.`;

export function buildFirstReadUserPrompt(input: FirstReadComposeInput): string {
  const isValueFirst = (input.hookCandidates?.length ?? 0) > 0;
  const sections: string[] = [
    `DATA RECENCY:`,
    formatDataRecency(input),
    ``,
    `TRANSACTION CONTEXT:`,
    `- Total transactions in window: ${input.transactionCountTotal}`,
    `- Window length: ${input.windowDays} days`,
    ``,
    `VALUE PROFILE (Stated Intent — what the user said in the Value Map):`,
    formatValueProfile(input.valueProfile),
    ``,
    `GOAL:`,
    input.goalSummary ?? '(none set yet)',
    ``,
    `FINANCIAL FACTS (Layer 1 — confirmed, server-computed; cite verbatim, do not recompute):`,
    formatFinancialFacts(input.financialFacts),
    ``,
  ];

  if (isValueFirst) {
    sections.push(
      `HOOK CANDIDATES (the 2-3 specific clusters you can see but cannot read alone — these are the CLOSE):`,
      formatHookCandidates(input.hookCandidates ?? []),
      ``,
    );
  } else {
    sections.push(
      `BLOCKER (a required input for the goal math is missing — when present this IS the lead, not a footnote):`,
      formatBlocker(input.blocker),
      ``,
      `LEVERS (computed magnitudes — frame these numbers, do not invent them):`,
      formatLevers(input.levers),
      ``,
    );
  }

  sections.push(
    `BEHAVIOURAL CLUSTERS (top observations from their actual transactions):`,
    input.topClusterBehaviours.length === 0
      ? '(no clusters with sufficient data — fall back to the transaction count and acknowledge the thin data)'
      : input.topClusterBehaviours.map(formatClusterForPrompt).join('\n\n'),
    ``,
    isValueFirst
      ? `COMPOSE THE FIRST READ NOW. Follow the STRUCTURE contract: lead with the Layer 1 picture (income / fixed costs / free cash flow / goal sitting), ≤2 BEHAVIOURAL CLUSTERS body observations, CLOSE with the HOOK (2-3 items from HOOK CANDIDATES as statements of curiosity) and the [CTA:start_value_map_real]Tell me what these mean[/CTA] line. Output the composed message text only — no markdown code fences, no preamble, no explanation. Sign off with "— C." on its own line.`
      : `COMPOSE THE FIRST READ NOW. Follow the STRUCTURE contract: lead, ≤2 body observations, close with one sized lever + one [CTA:…]…[/CTA] ask. Output the composed message text only — no markdown code fences, no preamble, no explanation. Sign off with "— C." on its own line.`,
  );

  return sections.join('\n');
}

function formatFinancialFacts(facts: FinancialFacts | null | undefined): string {
  if (!facts) return '(no financial facts on file yet — fall back to qualitative framing)';
  const lines: string[] = [];
  lines.push(`- Net monthly income: ${facts.net_monthly_income ?? '(not on file)'}`);
  lines.push(`- Total fixed costs / month: ${facts.total_fixed_costs ?? '(not on file)'}`);
  lines.push(`- Free cash flow / month: ${facts.free_cash_flow ?? '(not computable until both income and fixed costs are on file)'}`);
  if (facts.monthly_rent != null) {
    lines.push(`- (of which) Housing: ${facts.monthly_rent}`);
  }
  return lines.join('\n');
}

function formatHookCandidates(hooks: HookCandidate[]): string {
  if (hooks.length === 0) return '(no hook candidates — close on a qualitative observation)';
  return hooks
    .map((h, idx) => {
      return [
        `${idx + 1}. **${h.label}**`,
        `   - cluster_id: ${h.cluster_id}`,
        `   - recent amount (window): ${h.recent_amount}`,
        `   - pattern hint: ${h.period_hint}`,
        `   - candidate quadrants: ${h.candidate_quadrants.join(' | ')}`,
      ].join('\n');
    })
    .join('\n');
}

function formatBlocker(blocker: Lever | null | undefined): string {
  if (!blocker || blocker.type !== 'supply_input') {
    return '(no blocker — every required pace input is populated)';
  }
  // User-side phrasing: tapping the CTA sends this label as if the user said it.
  const ctaHint = blocker.field === 'net_monthly_income'
    ? "[CTA:supply_input]Here's my monthly take-home[/CTA]"
    : blocker.field === 'target_date'
      ? `[CTA:supply_input]Set a target date for ${blocker.goalName}[/CTA]`
      : `[CTA:supply_input]Set the target amount for ${blocker.goalName}[/CTA]`;
  return [
    `- field: ${blocker.field}`,
    `- goal: ${blocker.goalName}`,
    `- unlocks: ${blocker.unlocks}`,
    `- LEAD WITH THIS. Frame it as the one thing between the user and the goal math.`,
    `- CLOSE WITH THIS CTA (verbatim, on its own line just before "— C."): ${ctaHint}`,
  ].join('\n');
}

function formatLevers(levers: Lever[] | undefined): string {
  if (!levers || levers.length === 0) {
    return '(no actionable levers derived — close with one tappable ask that sharpens the picture)';
  }
  return levers.map(formatLever).join('\n\n');
}

function formatLever(lever: Lever): string {
  switch (lever.type) {
    case 'supply_input':
      return `- supply_input lever: ${lever.field} (goal: ${lever.goalName}, unlocks: ${lever.unlocks})`;
    case 'cut': {
      const impact = lever.goalImpactMonths != null
        ? `${lever.goalImpactMonths} month${lever.goalImpactMonths === 1 ? '' : 's'} sooner`
        : 'impact not computable until income is on file';
      return [
        `- cut lever (use this for the close if no blocker):`,
        `  - category: ${lever.category}`,
        `  - currently: ${lever.currentMonthly}/month`,
        `  - suggested trim: ${lever.suggestedCut}/month`,
        `  - goal impact: ${impact}`,
        `  - CTA template: [CTA:cut_lever]Trim ${lever.suggestedCut} from ${lever.category}[/CTA]`,
      ].join('\n');
    }
    case 'shift':
      return `- shift lever: ${lever.category} (${lever.rationale})`;
    case 'reallocate':
      return `- reallocate lever: ${lever.amount} from ${lever.from} → ${lever.to}`;
  }
}

function formatDataRecency(input: FirstReadComposeInput): string {
  if (!input.dataWindowEnd || input.dataAgeDays == null) {
    return '- No transactions on file. Do not invent any.';
  }
  const stale = input.dataAgeDays > 14;
  const lines = [
    `- Most recent transaction in this dataset: ${input.dataWindowEnd} (${input.dataAgeDays} day${input.dataAgeDays === 1 ? '' : 's'} ago).`,
  ];
  if (stale) {
    lines.push(
      `- THE DATA IS ${input.dataAgeDays} DAYS STALE. Acknowledge this in the first or second line of the read. Frame observations as "as of ${input.dataWindowEnd}", not as current. Do not refer to any activity happening today or this week.`,
    );
  }
  return lines.join('\n');
}

function formatValueProfile(profile: UserValueProfile): string {
  if (!profile.has_value_map) return '(user has not completed the Value Map — Layer 2 unavailable)';
  const entries = Object.entries(profile.by_category);
  if (entries.length === 0) return '(no confident category-level signal yet — signal_count too low)';
  return entries
    .map(([category, quadrants]) => {
      const dominant = (Object.entries(quadrants) as Array<[keyof typeof quadrants, number]>)
        .sort((a, b) => b[1] - a[1])[0];
      const pct = Math.round(dominant[1] * 100);
      return `- ${category}: ${dominant[0]} (${pct}%, n=${profile.signal_count[category] ?? 0})`;
    })
    .join('\n');
}

function formatClusterForPrompt(b: ClusterBehaviour): string {
  const clean = b.cluster_type === 'merchant'
    ? normaliseMerchantDescription(b.cluster_id)
    : b.cluster_id;
  const lines: string[] = [`**${clean}** (${b.cluster_type}, window ${b.window_days}d, completeness ${b.data_completeness})`];

  if (b.recurrence.pattern_label !== 'sparse') {
    lines.push(
      `- recurrence: ${b.recurrence.pattern_label}` +
        (b.recurrence.median_interval_days != null
          ? `, median interval ${b.recurrence.median_interval_days}d`
          : '') +
        `, regularity ${b.recurrence.regularity_score.toFixed(2)}`,
    );
  } else {
    lines.push('- recurrence: sparse');
  }

  if (b.trend.direction) {
    const slope = b.trend.slope_percent_per_month;
    lines.push(
      `- trend: ${b.trend.direction}` +
        (slope != null ? ` (${slope >= 0 ? '+' : ''}${slope.toFixed(0)}%/mo)` : '') +
        `, confidence ${b.trend.confidence.toFixed(2)}`,
    );
  }

  lines.push(
    `- time: weekday share ${(b.time_pattern.weekday_share * 100).toFixed(0)}%` +
      (b.time_pattern.dominant_day != null
        ? `, dominant day ${dayName(b.time_pattern.dominant_day)}`
        : ''),
  );

  lines.push(
    `- amount: mean ${b.amount_profile.mean_amount.toFixed(2)}, range ${b.amount_profile.min_amount.toFixed(2)}–${b.amount_profile.max_amount.toFixed(2)}, consistency ${b.amount_profile.consistency_label}`,
  );

  lines.push(
    `- lifecycle: ${b.lifecycle.status}, first ${b.lifecycle.first_seen}, last ${b.lifecycle.last_seen} (${b.lifecycle.days_since_last}d ago)` +
      (b.lifecycle.appeared_within_window ? ' [new in window]' : ''),
  );

  return lines.join('\n');
}

function dayName(dow: number): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow] ?? String(dow);
}
