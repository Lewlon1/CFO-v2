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
import { currencySymbol, formatMoney } from '@/lib/format/money';

const DAYS_PER_MONTH = 30.44;
import type { SpendingBreakdown } from '@/lib/analytics/spending-breakdown';
import type { ReadRecipe } from '@/lib/ai/first-read-recipe';

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
  /**
   * Pre-rendered observational sentence about the user's most-above-band bill,
   * or null when no above-band verdict exists. Single sentence, safe-phrased
   * by `formatBenchmarkObservation`. The model surfaces this near-verbatim
   * when present — never invents or recomputes it.
   */
  benchmarkObservation?: string | null;
  /**
   * Layer 1 — deterministic, server-computed spending breakdown (top categories,
   * biggest merchant, largest transaction, uncategorised share). Always rendered
   * when present, in both modes. Cited verbatim, never recomputed.
   */
  spendingBreakdown?: SpendingBreakdown | null;
  /** Goal-conditioned LEAD emphasis. Sets which finding the Read opens on; all layers still compose. */
  readRecipe?: ReadRecipe;
  /**
   * Recompose mode — present only for value_first_recompose. When set, the Read
   * is a DELTA: it leads on what the user's Value Map sorting unlocked, never
   * restates the prior Read's Layer 1, and closes on a directive into chat.
   */
  priorReadSummary?: PriorReadSummary | null;
  /** The merchant keys actually put in front of the user in the Value Map (Phase 1 selection). */
  valueMapCardKeys?: string[] | null;
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
  /** Composition mode — 'value_first' shifts the close from lever-CTA to hook-CTA; 'value_first_recompose' is the post-Value-Map delta. */
  mode?: 'default' | 'value_first' | 'value_first_recompose';
  /** The hook items the composer handed the model. Persisted so the Value Map step can run on the same real flagged transactions. */
  hook_candidates?: HookCandidate[] | null;
  /** Which LEAD recipe drove this Read (visibility | target | control | open), or null pre-change. */
  read_recipe?: ReadRecipe | null;
  /** Whether the composed prose actually surfaced a breakdown category or headline number. */
  breakdown_cited?: boolean;
  /** True when this composition is the post-Value-Map delta recompose. */
  is_recompose?: boolean;
  /** Probe: does the recompose's first sentence string-match the prior Read's first sentence (should be false on a well-formed delta). */
  repeated_opening?: boolean;
};

export type FirstReadComposeOutput = {
  composedMessage: string;
  metadata: FirstReadMetadata;
};

/**
 * Summary of the prior First Read, handed to the recompose so it knows what is
 * ALREADY SAID and must not be restated. Built by the recompose route from the
 * first assistant message + its persisted metadata.
 */
export type PriorReadSummary = {
  /** Income / fixed costs / free cash flow were already stated as standing facts. */
  layer1Stated: boolean;
  /** The goal target was already revealed. */
  goalStatedAsReveal: boolean;
  /** Merchants the prior Read named (normalised). Do not re-explain as new findings. */
  merchantsAlreadyNamed: string[];
  /** The prior "I can see but can't read" hook set — its job is done. */
  hookMerchantsUsed: string[];
  /** First sentence of the prior Read, for the repeated_opening probe. */
  firstSentence?: string | null;
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
- Cluster totals and transaction counts MUST come from the "volume" line in BEHAVIOURAL CLUSTERS (e.g. "7 txns totalling 256.62 over 90d"). Never multiply mean × span, multiply mean × occurrence-count, or otherwise compute a sum yourself. If the volume line is absent for a cluster, do not cite a total.
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
- Cluster totals and transaction counts MUST come from the "volume" line in BEHAVIOURAL CLUSTERS (e.g. "7 txns totalling 256.62 over 90d"). Never multiply mean × span, multiply mean × occurrence-count, or otherwise compute a sum yourself. If the volume line is absent for a cluster, do not cite a total.
- If the DATA RECENCY section shows the data is more than 14 days stale, acknowledge that explicitly in the first or second line. Do not imply the activity is happening now.
- Do not say a merchant is dormant unless its lifecycle status is "dormant".
- Income, fixed costs, and free cash flow come from FINANCIAL FACTS verbatim — never recompute them in your head. If a value is null in the data, do not invent one.

LENGTH & FORMAT:
- Hard cap: 250 words.
- Plain prose. Bold (**) cluster names when first mentioned.
- The CTA is on its own line, immediately before "— C.".
- Sign off "— C." on its own line.`;

/**
 * Recompose variant — the message that follows the user's Value Map in the
 * value-first flow. It is NOT a second First Read: it leads on what the sorting
 * unlocked, never restates Layer 1, never re-explains a merchant the user just
 * sorted, and closes on a DIRECTIVE that hands into chat (not another hook, not
 * another card-sort). It inherits the VALUE-FIRST voice and honesty blocks
 * verbatim (thread consistency — see the voice fork note in the session log);
 * only STRUCTURE and CLOSE differ.
 */
export const FIRST_READ_SYSTEM_PROMPT_RECOMPOSE = `You are the user's CFO. This is NOT the first thing they have seen. They have already read one Read from you, and they have just finished sorting a set of their real transactions in the Value Map — telling you what those merchants mean to them. This message is the payoff for that work. It is the LAST thing you write before the conversation opens up. Sign off "— C." on its own line.

STRUCTURE (this is the contract):
1. LEAD — open on what their sorting just UNLOCKED. Not the standing facts they already know. Follow READ FOCUS for the angle:
   - visibility → lead on the picture their sorting made legible: the proportion of spend now accounted for and where it concentrates (named-merchant proportions / absolute amounts when category coverage is low — see DATA).
   - target → lead on the gap as it now stands against the goal — what's reaching it vs what it needs — sharpened by what they just classified.
   - control → lead on the trajectory / biggest drain, now that intent is attached.
   - open → lead on the single sharpest thing the new classifications reveal.
2. BODY — at most 1-2 observations the NEW Layer 2 makes possible: a stated-vs-actual divergence now visible ("you called X a Leak — it's your second-biggest outflow"), or the concentration of a quadrant. Reference their sorts as GIVENS, never re-derive them. The single biggest remaining unknown (e.g. the uncategorised share) may be named here, plainly, as the thing still between them and a clean read.
3. CLOSE — a DIRECTIVE on their own money + a handoff into the conversation. Name the single highest-value next action (resolve the uncategorised, confirm what's reaching the goal, trim the named drain, set the missing target) and point them into chat to do it. Emit the CTA on its own line immediately before "— C.". The CTA label is written from the USER's point of view and lands them in the open conversation, e.g. [CTA:open_chat]Let's sort what's uncategorised[/CTA], [CTA:open_chat]Show me what's reaching the goal[/CTA]. This is a directive that opens the room — not another card-sort step, not a question.

ALREADY SAID — DO NOT RESTATE (these are givens; reference in a clause at most). The specific items are in the ALREADY SAID section of the DATA below:
- Income / fixed costs / free cash flow as standing facts.
- The goal target as a fresh reveal.
- The merchants already named in the first Read.
- The "I can see this but can't read it" hook — its job is DONE. Do not open another one.

BANNED IN THE RECOMPOSE:
- Re-opening on Layer 1 (income / fixed / FCF / "the clock is running").
- Re-explaining a merchant the user just sorted as if it were a new finding.
- A second "I can see X but can't read it without you" hook.
- Any paragraph ending in a question back to the user.
- "What do you think?" / "Does that sound right?" closes.
- The words "advice" or "advise" anywhere.
- Emoji. Product names or buy/sell/switch calls.
- Inventing magnitudes — every number comes verbatim from the DATA below.

HONESTY (NO HALLUCINATION):
- Use only the dates, amounts, merchants, and patterns from the structured data below. Do not invent any of these.
- Never attribute a transaction to today's date. The data is a snapshot.
- Cluster totals and transaction counts MUST come from the "volume" line in BEHAVIOURAL CLUSTERS. Never compute a sum yourself.
- Proportions and percentages come verbatim from SPENDING BREAKDOWN. When category coverage is low (a large uncategorised share), DO NOT state a total-spend % you can't support — lead on named-merchant proportions and absolute amounts instead.
- Income, fixed costs, and free cash flow come from FINANCIAL FACTS verbatim — never recompute them.

LENGTH & FORMAT: hard cap 200 words (tighter than the first Read — it's a delta). Plain prose. Bold (**) merchant names on first mention. CTA on its own line before "— C.". Sign off "— C." on its own line.`;

export function buildFirstReadUserPrompt(input: FirstReadComposeInput): string {
  const isRecompose = input.priorReadSummary != null;
  const isValueFirst = (input.hookCandidates?.length ?? 0) > 0;
  const currency = input.financialFacts?.currency ?? 'EUR';
  const symbol = currencySymbol(currency).trim() || currency;
  const sections: string[] = [
    `CURRENCY: All amounts are in ${currency}. Always format money with "${symbol}" — never use any other currency symbol (e.g. never £ or $ unless that IS the symbol above).`,
    ``,
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
    formatFinancialFacts(input.financialFacts, currency),
    ``,
    `SPENDING BREAKDOWN (Layer 1 — server-computed; cite verbatim, never recompute a % or a sum):`,
    formatSpendingBreakdown(input.spendingBreakdown, currency),
    ``,
  ];

  // Recompose mode: render WHAT THE USER JUST SORTED (the payoff source) and
  // ALREADY SAID (the do-not-restate contract) before the goal-math sections.
  if (isRecompose) {
    sections.push(
      `WHAT THE USER JUST SORTED (Layer 2 just landed — this is the payoff source; reference these as GIVENS):`,
      formatWhatJustSorted(input),
      ``,
      `ALREADY SAID — DO NOT RESTATE (these were in the first Read; reference in a clause at most):`,
      formatAlreadySaid(input.priorReadSummary ?? null),
      ``,
    );
  }

  // BLOCKER + LEVERS are rendered in BOTH modes. The value-first close stays the
  // HOOK, but the goal math (blocker "set a target", sized cut levers) must be
  // available for the LEAD — the target recipe leans on it.
  sections.push(
    `BLOCKER (a required input for the goal math is missing — when present this IS the lead under the target recipe, not a footnote):`,
    formatBlocker(input.blocker, isValueFirst),
    ``,
    `LEVERS (computed magnitudes — frame these numbers, do not invent them):`,
    formatLevers(input.levers),
    ``,
  );

  if (isValueFirst) {
    sections.push(
      `HOOK CANDIDATES (the 2-3 specific clusters you can see but cannot read alone — these are the CLOSE):`,
      formatHookCandidates(input.hookCandidates ?? [], currency),
      ``,
    );
  }

  if (input.benchmarkObservation) {
    sections.push(
      `BENCHMARK OBSERVATION (single sentence, pre-rendered, cite near-verbatim — do not recompute or rephrase the band):`,
      input.benchmarkObservation,
      ``,
      `Rules for the BENCHMARK OBSERVATION:`,
      `- Surface it at most once, neutrally, as an observation. Cite the band.`,
      `- Cite the source ONLY if the pre-rendered sentence already contains "Source: …". If it does not, do not invent a regulator, dataset, or organisation name and do not add a "per X" clause. Silent on source is the correct behaviour for unsourced bands.`,
      `- Never use the words "switch", "should", "too high", "overpaying", "recommend", or any synonym implying the user must change providers.`,
      `- Never name a provider beyond what is already in the {label} portion of the pre-rendered sentence.`,
      `- This is observation, not prescription. If the user wants to act, you may offer to talk through renegotiating in a later turn — never as a directive here.`,
      ``,
    );
  }
  sections.push(
    `READ FOCUS — ${input.readRecipe ?? 'open'} (this sets the LEAD only; all layers still compose):`,
    formatReadFocus(input.readRecipe ?? 'open', input.goalSummary),
    ``,
    `BEHAVIOURAL CLUSTERS (top observations from their actual transactions):`,
    input.topClusterBehaviours.length === 0
      ? '(no clusters with sufficient data — fall back to the transaction count and acknowledge the thin data)'
      : input.topClusterBehaviours.map((b) => formatClusterForPrompt(b, currency)).join('\n\n'),
    ``,
    isRecompose
      ? `COMPOSE THE RECOMPOSE NOW. Lead on what their sorting unlocked per READ FOCUS, ≤2 delta observations from the NEW Layer 2 (WHAT THE USER JUST SORTED), close on a directive + [CTA:open_chat]…[/CTA] that lands them in chat. Do not restate anything in ALREADY SAID. Do not open a new hook. Hard cap 200 words. Output the message text only — no markdown code fences, no preamble. Sign off with "— C." on its own line.`
      : isValueFirst
      ? `COMPOSE THE FIRST READ NOW. Follow READ FOCUS for the LEAD, then ≤2 BEHAVIOURAL CLUSTERS body observations, then CLOSE with the HOOK (2-3 items from HOOK CANDIDATES as statements of curiosity) and the [CTA:start_value_map_real]Tell me what these mean[/CTA] line. Output the composed message text only — no markdown code fences, no preamble, no explanation. Sign off with "— C." on its own line.`
      : `COMPOSE THE FIRST READ NOW. Follow READ FOCUS for the LEAD, then ≤2 body observations, then close with one sized lever + one [CTA:…]…[/CTA] ask. Output the composed message text only — no markdown code fences, no preamble, no explanation. Sign off with "— C." on its own line.`,
  );

  return sections.join('\n');
}

function formatFinancialFacts(
  facts: FinancialFacts | null | undefined,
  currency: string,
): string {
  if (!facts) return '(no financial facts on file yet — fall back to qualitative framing)';
  const m = (v: number | null | undefined) =>
    v == null ? null : formatMoney(v, currency);
  const lines: string[] = [];

  // Variable income: do NOT present a single flat monthly figure. The income
  // pattern was detected as variable, so a "your monthly income is X" framing
  // is misleading — lead with the trailing-3-month average and name the swing.
  if (facts.income_shape === 'variable') {
    const t3m = m(facts.t3m_income_monthly);
    lines.push(
      `- Income: VARIABLE (irregular deposits). Do NOT call any number "your monthly income".` +
        (t3m
          ? ` Trailing-3-month average ≈ ${t3m}/mo — cite it as a trailing average, and note income swings month to month.`
          : ` Treat income as uncertain and avoid a precise monthly figure.`),
    );
  } else {
    lines.push(`- Net monthly income: ${m(facts.net_monthly_income) ?? '(not on file)'}`);
  }
  lines.push(`- Total fixed costs / month: ${m(facts.total_fixed_costs) ?? '(not on file)'}`);
  lines.push(`- Free cash flow / month: ${m(facts.free_cash_flow) ?? '(not computable until both income and fixed costs are on file)'}`);
  if (facts.monthly_rent != null) {
    lines.push(`- (of which) Housing: ${m(facts.monthly_rent)}`);
  }
  return lines.join('\n');
}

function formatSpendingBreakdown(
  breakdown: SpendingBreakdown | null | undefined,
  currency: string,
): string {
  if (!breakdown || breakdown.top_categories.length === 0) {
    return '(breakdown unavailable — too few transactions)';
  }
  const m = (v: number) => formatMoney(v, currency);
  const lines: string[] = [];
  lines.push(`- Total tracked spend (window): ${m(breakdown.total_spend)}`);
  lines.push(
    `- Top categories: ` +
      breakdown.top_categories
        .map((c) => `${c.category} ${m(c.total)} (${c.pct}%)`)
        .join(', '),
  );
  if (breakdown.biggest_merchant) {
    lines.push(
      `- Biggest single merchant by spend: ${breakdown.biggest_merchant.name} — ${m(breakdown.biggest_merchant.total)} across ${breakdown.biggest_merchant.txn_count} txns`,
    );
  }
  if (breakdown.largest_transaction) {
    lines.push(
      `- Largest single transaction: ${breakdown.largest_transaction.merchant} ${m(breakdown.largest_transaction.amount)} on ${breakdown.largest_transaction.date}`,
    );
  }
  lines.push(`- Uncategorised share: ${breakdown.uncategorised_pct}%`);
  return lines.join('\n');
}

/**
 * One block per recipe. The COMPOSE directive points here for the LEAD; the
 * body rules, hook close, honesty guards, and CTA contract are unchanged. The
 * recipe only sets which finding the Read opens on.
 */
function formatReadFocus(recipe: ReadRecipe, goalSummary: string | null | undefined): string {
  const goal = goalSummary ?? 'their goal';
  switch (recipe) {
    case 'visibility':
      return [
        `The user said they don't know where their money goes. LEAD with the SPENDING BREAKDOWN made`,
        `legible: the biggest category, the single biggest merchant by spend, the largest single`,
        `transaction, and the one line most likely to surprise them — in the first three sentences.`,
        `Then ≤2 body observations, then the close.`,
      ].join('\n');
    case 'target':
      return [
        `The user is working toward ${goal}. LEAD with where they stand against it: free cash flow vs`,
        `the monthly contribution the goal needs vs what's currently reaching it. Use the monthly figure(s)`,
        `GIVEN in the GOAL block verbatim — never recompute or invent one, and never ignore the amount`,
        `already saved. If the GOAL block gives a compound-growth rate band, name compounding in plain`,
        `language and show the range (e.g. "~Xat the low end, ~Y if returns are stronger") rather than a`,
        `single scary number, then give a clear verdict on whether the target is realistic. If the target`,
        `amount or date is missing, the BLOCKER ("set a target") IS the lead. Body: the biggest drain`,
        `pulling against the goal. Then the close.`,
      ].join('\n');
    case 'control':
      return [
        `LEAD with the trajectory and the single biggest recurring drain. Body: one more drain or a`,
        `divergence. Then the close.`,
      ].join('\n');
    case 'open':
    default:
      return [
        `No goal and no struggle on file. LEAD with free cash flow as the headline number and one`,
        `specific observation, then invite them to name what they're building toward. (This is the only`,
        `recipe where a "what are you building toward" framing in the body is correct.)`,
      ].join('\n');
  }
}

function formatHookCandidates(hooks: HookCandidate[], currency: string): string {
  if (hooks.length === 0) return '(no hook candidates — close on a qualitative observation)';
  return hooks
    .map((h, idx) => {
      return [
        `${idx + 1}. **${h.label}**`,
        `   - cluster_id: ${h.cluster_id}`,
        `   - recent amount (window): ${formatMoney(h.recent_amount, currency)}`,
        `   - pattern hint: ${h.period_hint}`,
        `   - candidate quadrants: ${h.candidate_quadrants.join(' | ')}`,
      ].join('\n');
    })
    .join('\n');
}

function formatBlocker(blocker: Lever | null | undefined, isValueFirst = false): string {
  if (!blocker || blocker.type !== 'supply_input') {
    return '(no blocker — every required pace input is populated)';
  }
  // User-side phrasing: tapping the CTA sends this label as if the user said it.
  const ctaHint = blocker.field === 'net_monthly_income'
    ? "[CTA:supply_input]Here's my monthly take-home[/CTA]"
    : blocker.field === 'target_date'
      ? `[CTA:supply_input]Set a target date for ${blocker.goalName}[/CTA]`
      : `[CTA:supply_input]Set the target amount for ${blocker.goalName}[/CTA]`;
  const lines = [
    `- field: ${blocker.field}`,
    `- goal: ${blocker.goalName}`,
    `- unlocks: ${blocker.unlocks}`,
    `- LEAD WITH THIS under the target recipe. Frame it as the one thing between the user and the goal math.`,
  ];
  if (isValueFirst) {
    // Value-first close is the HOOK + start_value_map_real CTA (system prompt
    // contract). The blocker informs the LEAD only here — do NOT emit the
    // supply_input CTA, or it collides with the hook close.
    lines.push(
      `- This sets the LEAD only. The CLOSE remains the HOOK and its [CTA:start_value_map_real] line — do not emit a supply_input CTA.`,
    );
  } else {
    lines.push(
      `- CLOSE WITH THIS CTA (verbatim, on its own line just before "— C."): ${ctaHint}`,
    );
  }
  return lines.join('\n');
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

/**
 * What the user just sorted — the recompose payoff source. Renders the directly
 * classified merchants (Layer 2 by_merchant, just populated) plus the card set
 * that was put in front of them. These are GIVENS: the recompose references the
 * user's own calls, it does not re-derive them.
 */
function formatWhatJustSorted(input: FirstReadComposeInput): string {
  const lines: string[] = [];
  const merchantEntries = Object.entries(input.valueProfile.by_merchant ?? {});
  if (merchantEntries.length > 0) {
    lines.push(`Merchants the user just classified (their own words on what these mean):`);
    for (const [merchant, quadrants] of merchantEntries) {
      const dominant = (Object.entries(quadrants) as Array<[string, number]>)
        .sort((a, b) => b[1] - a[1])[0];
      lines.push(`- ${merchant}: ${dominant?.[0] ?? 'unsure'}`);
    }
  }
  const cardKeys = input.valueMapCardKeys ?? [];
  if (cardKeys.length > 0) {
    lines.push(`Cards presented in this Value Map (${cardKeys.length}): ${cardKeys.join(', ')}`);
  }
  if (lines.length === 0) {
    return '(no fresh sorts captured — the Value Map returned thin signal; lead on the biggest remaining unknown instead)';
  }
  return lines.join('\n');
}

/** The do-not-restate contract from the prior Read. */
function formatAlreadySaid(prior: PriorReadSummary | null): string {
  if (!prior) return '(no prior Read on file — treat nothing as already said)';
  const lines: string[] = [];
  if (prior.layer1Stated) {
    lines.push(`- Income / fixed costs / free cash flow were already stated as standing facts. Do NOT re-open on them.`);
  }
  if (prior.goalStatedAsReveal) {
    lines.push(`- The goal target was already revealed. Do NOT re-reveal it.`);
  }
  if (prior.merchantsAlreadyNamed.length > 0) {
    lines.push(`- Merchants already named in the first Read (reference as givens, do not re-explain as new): ${prior.merchantsAlreadyNamed.join(', ')}`);
  }
  if (prior.hookMerchantsUsed.length > 0) {
    lines.push(`- The "I can see but can't read it" hook already ran on: ${prior.hookMerchantsUsed.join(', ')}. Its job is DONE — do not open another hook.`);
  }
  return lines.length > 0 ? lines.join('\n') : '(nothing flagged as already said)';
}

function formatValueProfile(profile: UserValueProfile): string {
  if (!profile.has_value_map) return '(user has not completed the Value Map — Layer 2 unavailable)';

  const categoryEntries = Object.entries(profile.by_category);
  const merchantEntries = Object.entries(profile.by_merchant);

  if (categoryEntries.length === 0 && merchantEntries.length === 0) {
    return '(no confident signal yet — Value Map answers below threshold)';
  }

  const lines: string[] = [];

  if (categoryEntries.length > 0) {
    lines.push('Categories:');
    for (const [category, quadrants] of categoryEntries) {
      const dominant = (Object.entries(quadrants) as Array<[keyof typeof quadrants, number]>)
        .sort((a, b) => b[1] - a[1])[0];
      const pct = Math.round(dominant[1] * 100);
      lines.push(`- ${category}: ${dominant[0]} (${pct}%, n=${profile.signal_count[category] ?? 0})`);
    }
  }

  if (merchantEntries.length > 0) {
    // Merchants the user has directly classified via the real-transactions
    // Value Map. Cite these by name when they appear in BEHAVIOURAL CLUSTERS
    // and DO NOT surface them as "I can't read alone" — the user already said
    // what they think.
    lines.push('Merchants classified directly:');
    for (const [merchant, quadrants] of merchantEntries) {
      const dominant = (Object.entries(quadrants) as Array<[keyof typeof quadrants, number]>)
        .sort((a, b) => b[1] - a[1])[0];
      lines.push(`- ${merchant}: ${dominant[0]} (n=${profile.signal_count_by_merchant[merchant] ?? 0})`);
    }
  }

  return lines.join('\n');
}

function formatClusterForPrompt(b: ClusterBehaviour, currency: string): string {
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

  const total = Math.abs(b.total_amount);
  // Per-month equivalent so recurring spend is legible as a rate, not a raw
  // window total ("X over 90 days" forces the user to do the division). Cite
  // the /mo figure for recurring patterns; keep the window total for context.
  const perMonth = b.window_days > 0 ? total / (b.window_days / DAYS_PER_MONTH) : null;
  const isRecurring =
    b.recurrence.pattern_label === 'monthly' || b.recurrence.pattern_label === 'weekly';
  lines.push(
    `- volume: ${b.transaction_count} txns totalling ${formatMoney(total, currency)} over ${b.window_days}d` +
      (perMonth != null
        ? ` (≈ ${formatMoney(perMonth, currency)}/mo${isRecurring ? ' — recurring, prefer the /mo figure' : ''})`
        : ''),
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
