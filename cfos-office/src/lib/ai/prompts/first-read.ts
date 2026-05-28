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

export function buildFirstReadUserPrompt(input: FirstReadComposeInput): string {
  return [
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
    `BLOCKER (a required input for the goal math is missing — when present this IS the lead, not a footnote):`,
    formatBlocker(input.blocker),
    ``,
    `LEVERS (computed magnitudes — frame these numbers, do not invent them):`,
    formatLevers(input.levers),
    ``,
    `BEHAVIOURAL CLUSTERS (top observations from their actual transactions):`,
    input.topClusterBehaviours.length === 0
      ? '(no clusters with sufficient data — fall back to the transaction count and acknowledge the thin data)'
      : input.topClusterBehaviours.map(formatClusterForPrompt).join('\n\n'),
    ``,
    `COMPOSE THE FIRST READ NOW. Follow the STRUCTURE contract: lead, ≤2 body observations, close with one sized lever + one [CTA:…]…[/CTA] ask. Output the composed message text only — no markdown code fences, no preamble, no explanation. Sign off with "— C." on its own line.`,
  ].join('\n');
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
