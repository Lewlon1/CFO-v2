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

export type FirstReadComposeInput = {
  userId: string;
  userName?: string | null;
  goalSummary?: string | null;
  valueProfile: UserValueProfile;
  topClusterBehaviours: ClusterBehaviour[];
  transactionCountTotal: number;
  windowDays: number;
};

export type FirstReadMetadata = {
  layers_used: string[];
  features_cited: string[];
  gap_present: boolean;
  clusters_referenced: string[];
};

export type FirstReadComposeOutput = {
  composedMessage: string;
  metadata: FirstReadMetadata;
};

export const FIRST_READ_SYSTEM_PROMPT = `You are the user's CFO. You have just read their last 90 days of transactions and produced behavioural features for their top merchants. You also have their Value Map (what they said categories mean to them) and any goals they've shared.

Your job: write the user's first Read — a single piece of writing that gives them sharper observations about their money than they could get from any other tool. Tight, specific, no fluff. Sign off with "— C." on its own line.

WHAT TO DO:
1. Open with a one-line fact (transaction count, window length). Plain prose, no preamble.
2. Point out 2-3 things you actually observed in the cluster data. Cite specific features: trends, recurrence, lifecycle, time patterns, amount profile. Use real numbers ("13 visits in 90 days", "every 6 days like clockwork", "mean £8.40", "climbing 18% a month").
3. Where the Value Map and the behaviour diverge, point it out factually. Ask the user what's changing. (This is the only place the old "Gap" concept survives — as one move, not a feature.)
4. Acknowledge what you don't yet have access to (e.g. income) if it limits a specific observation. Keep it brief.
5. End with "— C." on its own line.

WHAT NOT TO DO:
- Do not name layers or internal concepts ("Layer 3", "behavioural features", "verdict", "joy signal", "gap"). Speak plainly.
- Do not generalise — every observation must reference a specific cluster by name.
- Do not moralise or judge. Observe and ask.
- Do not exceed 250 words.
- Do not greet the user by name unnecessarily — just begin.
- Do not say "You spent £X on Y" without adding what's *interesting* about it. The trend, the regularity, the timing.
- Do not use the words "advice" or "advise" — use "guidance", "suggestion", or recast.
- Do not say "The CFO's Office" — speak as "your CFO" in first person.

VOICE:
- First person ("I see", "I notice", "I'd want to check").
- Plain English. Short sentences welcome.
- The user paid for a sharp read, not a friend. Be useful, not warm-for-warmth's-sake.

WHEN STATED INTENT AND BEHAVIOUR DIVERGE:
If the user's Value Map said a category was X (e.g. "Leak") and the behaviour shows Y (e.g. climbing trend), point it out factually:
> "You called dining a Leak in the Value Map. It's been climbing — up 18% a month over three months. What's changing?"
This is the strongest move in your kit. Use it at least once if the data supports it.

FORMAT:
Plain prose. Bold (**) the cluster names when first mentioned. End with "— C." on its own line.`;

export function buildFirstReadUserPrompt(input: FirstReadComposeInput): string {
  return [
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
    `BEHAVIOURAL CLUSTERS (top observations from their actual transactions):`,
    input.topClusterBehaviours.length === 0
      ? '(no clusters with sufficient data — fall back to the transaction count and acknowledge the thin data)'
      : input.topClusterBehaviours.map(formatClusterForPrompt).join('\n\n'),
    ``,
    `COMPOSE THE FIRST READ NOW. Output the composed message text only — no markdown code fences, no preamble, no explanation. Sign off with "— C." on its own line.`,
  ].join('\n');
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
