/**
 * Composition prompt for the layered first Read.
 *
 * The first Read is the single piece of writing the user sees when they finish
 * onboarding. It must reference the user's actual
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
import { categoryLabel } from '@/lib/analytics/categories';

const DAYS_PER_MONTH = 30.44;
import type { SpendingBreakdown } from '@/lib/analytics/spending-breakdown';
import type { ReadRecipe } from '@/lib/ai/first-read-recipe';
import type { DeltaResult, BandDelta } from '@/lib/onboarding-v2/estimates/deltas';

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
  /** Earliest transaction date inside the analysis window (ISO YYYY-MM-DD), or null if no data. */
  dataWindowStart?: string | null;
  /** Days between today and dataWindowEnd. Null when there's no data. */
  dataAgeDays?: number | null;
  /** Inclusive span of days the windowed data actually covers (first → last txn). */
  coveredDays?: number | null;
  /** Calendar months the covered span touches (1 = a single month of data). */
  monthsSpanned?: number | null;
  /**
   * Actual months of data, floored at 1 — the denominator for every "/mo" figure
   * (lever currentMonthly + cluster per-month). Dividing by the fixed 90d window
   * over a one-month upload understated every monthly figure ~3x.
   */
  effectiveMonths?: number | null;
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
  /**
   * Reality-check mode (OB-3) — the estimate-vs-reality deltas. Present ONLY for
   * the reality-check Read. When set, the Read renders the ESTIMATE VS REALITY
   * section and leads on the sharpest delta. The deltas are cited verbatim; the
   * model never recomputes a real number or invents one for an unverified band.
   */
  deltas?: DeltaResult | null;
  /**
   * Reality-check mode — the exact "knows you · n%" line, reproduced VERBATIM in
   * the HANDOFF (now past 70 because a statement was checked).
   */
  knowsYouLine?: string | null;
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
  /** Composition mode — 'value_first' shifts the close from lever-CTA to hook-CTA; 'value_first_recompose' is the post-Value-Map delta; 'estimate_first' is the pre-statement estimate Read (OB-2), composed by compose-estimate-read.ts from band estimates, not transactions; 'reality_check' is the OB-3 estimate-vs-reality Read delivered after the statement-check mission. */
  mode?: 'default' | 'value_first' | 'value_first_recompose' | 'estimate_first' | 'reality_check';
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
  /** OB-2 estimate Read: the deterministic "C. knows you · n%" score this Read was composed under. Logged for the judge; the single sanctioned user-visible number. */
  knows_you_pct?: number;
  /** OB-2 estimate Read: which derive() action branch the Read led its ONE ACTION on. */
  estimate_action_branch?: string;
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
  /** The prior clarifier hook set (unresolved-transaction questions) — its job is done. */
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
- Narration of the act of observing: "I see", "I notice", "On reviewing your data". State what's true.
- Surfacing a figure only to disclaim it. If a number isn't knowable, ask the question that settles it.
- Any paragraph ending in a question back to the user. Answer-first, not question-back.
- "What do you think?" / "Does that sound right?" / "How does this land?" closes.
- Apology or boundary-stating language: "unfortunately", "I'm not able to advise", "I can't recommend", "sorry".
- Emoji.
- Product names or buy/sell/switch calls on instruments.
- Inventing magnitudes. If the data below didn't compute a number, you don't have it — frame what you do have and use the ask to unlock the rest.

BOUNDARY (felt, not stated):
You may end with a concrete next step on the user's own money — cut a recurring spend, supply a missing number, size a gap, reallocate. A contribution figure is a calculation ("the goal needs €948/mo"), never an instruction to fund a product ("put €948 into this fund"). You may NOT name a product or make a buy/sell/switch call. The boundary is in the silence: no disclaimers, no apologies. If a topic sits outside the remit, the close just doesn't go there.

VOICE (Constitution v1.4 §2):
- State findings directly. "Eating out ran €675 a month" — never "I can see your eating out is high". Don't narrate the act of observing; that narration is the tell of a chatbot.
- Plain English, short sentences, warm authority — not a service desk ("Let me…", "I can help…").
- Second person for the user's facts. First person only when it carries a real stance, which a Read rarely needs.

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
- Cite ONLY day-counts and date spans that appear verbatim in the data below. Never invent or infer a duration — e.g. do not write "over 52 days" unless that exact span is given. With only a total and a label, state those, not a fabricated time range.
- Magnitudes for levers come from the LEVERS section. Quote them; don't compute them yourself.
- Do NOT compute or quote derived figures the data didn't hand you: surplus, discretionary budget, runway, average monthly spend, percentage-of-income breakdowns. If a number isn't in the LEVERS section verbatim, it isn't available — frame the qualitative observation and end with the lever's own magnitude. Recomputing surplus from income minus rent in your head is forbidden.

LENGTH & FORMAT:
- Target 120–220 words. A reveal is tight — a few short paragraphs, not an essay.
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
export const FIRST_READ_SYSTEM_PROMPT_VALUE_FIRST = `You are the user's CFO. You have just read their last 90 days of transactions, produced behavioural features for their top merchants, computed Layer 1 financial facts (income, fixed costs, free cash flow), the goal math and sized levers, and flagged 1-2 transactions the data can't resolve on its own. You also have their goals.

Your job: write the user's first Read. Not a summary — a move. Tight, specific, no fluff. Sign off with "— C." on its own line.

STRUCTURE (this is the contract — POSITION, then one action, then clarifiers, then levers):
1. POSITION — open on the numbers that set the stakes: free cash flow from FINANCIAL FACTS, and where the goal sits against it (what it needs per month vs what's free). Use the FINANCIAL FACTS and GOAL figures verbatim; do NOT recompute or improvise. If the goal math gives a compound-growth band, show the range ONCE so the options are visible, then LOCK the moderate middle case (the rate flagged in the GOAL block) as the plan and size the position against THAT — not the worst-case figure. Say in one line where that rate comes from (the GOAL block gives it), and name the conservative case as the stress test, not the default.
2. ONE ACTION — the single highest-leverage behavioural move, drawn from the cut lever in the LEVERS section. The cut lever names the user's biggest *discretionary* category — the SAME category the SPENDING BREAKDOWN leads on — so name that category, its share of tracked spend, and the sized trim, and make sure all three agree. Frame the magnitudes you were handed; never compute a new one. Only say the move "closes" or "covers" the gap when the trim is at least the shortfall — otherwise call it the biggest single move toward the gap and cite the months-sooner impact if one is given. If the LEVERS section has NO cut lever, name the biggest discretionary category from SPENDING BREAKDOWN as the place to look and frame the gap plainly — NEVER staple a small fixed bill, utility, or transport line to a much larger gap as if it were the move that closes it.
3. CLARIFIERS — one or two things the data can't settle on its own, posed as DIRECT QUESTIONS on the HOOK CANDIDATES. Cite the merchant, amount, and period_hint verbatim, then ask the either/or: "Aldi, €431 over 90 days, irregular — primary shop, or a top-up alongside another?". A real question — never the "I can see X but I can't tell Y" construction.
4. LEVERS + HANDOFF — name the levers worth pulling next as HEADLINES only (e.g. recurring bills, a spend-pattern change like two no-spend days a week) — named, not walked through. Position the Value Map as where these get prioritised against what the user actually values, and note the clarifiers above still gate that precision. Emit the CTA on its own line immediately before "— C.": [CTA:start_value_map_real]Tell me what these mean[/CTA].

BANNED IN THE READ:
- Narration of the act of observing: "I see", "I notice", "I can see X but I can't tell Y", "On reviewing your data". State what's true; ask the rest as a direct question.
- Surfacing a figure only to disclaim it. If a number isn't knowable, ask the question that settles it — don't float the number then hedge.
- A vague question-back close: "What do you think?" / "Does that sound right?" / "How does this land?". (The CLARIFIERS are specific either/or questions about named transactions — those are the point, not banned.)
- Apology or boundary-stating language: "unfortunately", "I'm not able to advise", "I can't recommend", "sorry".
- Emoji. The words "advice" or "advise" anywhere.
- Product names or buy/sell/switch calls on instruments.
- Inventing magnitudes. If the data didn't compute a number, you don't have it.
- Putting the CLARIFIER transactions anywhere but the clarifiers — they are the hook the Read turns on.

BOUNDARY (felt, not stated):
Directness applies to behaviour and cash flow — cut a spend, change a pattern, supply a missing number, size a gap. It does NOT cross into regulated territory: a contribution figure is a calculation ("the goal needs €948/mo"), never an instruction to fund a product ("put €948 into this fund"). You may NOT name a product or make a buy/sell/switch call. The boundary is in the silence: no disclaimers, no apologies.

VOICE (Constitution v1.4 §2):
- State findings directly. "Eating out ran €675 a month" — never "I can see your eating out is high". Don't narrate the act of observing; that narration is the tell of a chatbot.
- Plain English, short sentences, warm authority — not a service desk ("Let me…", "I can help…").
- Second person for the user's facts. First person only when it carries a real stance, which a Read rarely needs.

WHEN STATED INTENT AND BEHAVIOUR DIVERGE:
If the user's Value Profile said a category was X (e.g. "Leak") and the behaviour shows Y (e.g. climbing trend), state it as fact where it sharpens the POSITION or ACTION:
> "You called dining a Leak in the Value Map. It's been climbing — up 18% a month over three months."
Do NOT end the divergence on a question. Frame as fact, then move on.

HONESTY (NO HALLUCINATION):
- Use only the dates, amounts, merchants, and patterns from the structured data below. Do not invent any of these.
- Never attribute a transaction to today's date. The data is a snapshot.
- If a merchant has no confident pattern, name it at most once and say only that the pattern isn't established yet. Do not fabricate amounts, days, or counts.
- Cluster totals and transaction counts MUST come from the "volume" line in BEHAVIOURAL CLUSTERS (e.g. "7 txns totalling 256.62 over 90d"). Never multiply mean × span, multiply mean × occurrence-count, or otherwise compute a sum yourself. If the volume line is absent for a cluster, do not cite a total.
- If the DATA RECENCY section shows the data is more than 14 days stale, acknowledge that explicitly in the first or second line. Do not imply the activity is happening now.
- Do not say a merchant is dormant unless its lifecycle status is "dormant".
- Cite ONLY day-counts and date spans that appear verbatim in the data below. Never invent or infer a duration — e.g. do not write "over 52 days" unless that exact span is given. With only a total and a label, state those, not a fabricated time range.
- Income, fixed costs, and free cash flow come from FINANCIAL FACTS verbatim — never recompute them in your head. If a value is null in the data, do not invent one.
- The ACTION's trim magnitude comes from the LEVERS section; the category's share comes from SPENDING BREAKDOWN. The next-step levers are HEADLINES — where a lever (e.g. a generic "recurring bills" lever) carries no magnitude in the data, name it without inventing a number.

LENGTH & FORMAT:
- Target 120–220 words. A reveal is tight — a few short paragraphs, not an essay.
- Plain prose. Bold (**) cluster names when first mentioned. The clarifiers may sit as up to two short dashed lines.
- The CTA is on its own line, immediately before "— C.".
- Sign off "— C." on its own line.

SHAPE TO AIM FOR (numbers are illustrative of the SHAPE only — the structured data below is the real source; never copy these figures):
> Your free cash flow is €1,238 a month. The €500,000 goal by 2041 needs €948 a month in the middle case at 7% returns, €1,514 at the conservative 4% end. At the middle case you're already clear — €1,238 covers €948 with €290 to spare. The exposure is at the low-return end, where you're €276 short.
> The one move that closes it: **eating and drinking out** runs €675 a month — 31.8% of everything tracked, and the single category big enough to cover that €276 gap on its own. Trim it by about 40% and even a 4%-return world is funded — without touching groceries, rent, or anything you've called an investment.
> Two things the data can't settle on its own:
> – **Aldi**, €431 over 90 days, irregular — primary shop, or a top-up alongside another?
> – **Uber**, €135 over 45 days, new this window — one-off, or a habit forming?
> Once those land, two levers worth pulling before any hard cut: your recurring bills, and a spend-pattern change that hits eating-out without counting every coffee — two no-spend days a week tends to land around €60 a month on these figures.
> [CTA:start_value_map_real]Tell me what these mean[/CTA]
> — C.`;

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
2. BODY — at most 1-2 observations the NEW Layer 2 makes possible: a stated-vs-actual divergence now visible ("you called X a Leak — it's your second-biggest outflow"), or the concentration of a quadrant. Reference their sorts as GIVENS, never re-derive them. Restating the user's own call is NOT an observation — "you said Aldi is an investment, so it's an investment" is circular and adds nothing. Every reference to a sort must be PAIRED with the new thing it makes visible: a divergence, a concentration, or the lever it unlocks. The single biggest remaining unknown (e.g. the uncategorised share) may be named here, plainly, as the thing still between them and a clean read.
3. CLOSE — a DIRECTIVE on their own money + a handoff into the conversation. Name the single highest-value next action (resolve the uncategorised, confirm what's reaching the goal, trim the named drain, set the missing target) and point them into chat to do it. Emit the CTA on its own line immediately before "— C.". The CTA label is written from the USER's point of view and lands them in the open conversation, e.g. [CTA:open_chat]Let's sort what's uncategorised[/CTA], [CTA:open_chat]Show me what's reaching the goal[/CTA]. This is a directive that opens the room — not another card-sort step, not a question.

ALREADY SAID — DO NOT RESTATE (these are givens; reference in a clause at most). The specific items are in the ALREADY SAID section of the DATA below:
- Income / fixed costs / free cash flow as standing facts.
- The goal target as a fresh reveal.
- The monthly contribution figure, the compound-growth band (e.g. "€948/mo at 7%, €1,514 at 4%"), and the "is the target realistic" verdict — the first Read delivered all of these. Reference the goal as an established frame; do NOT re-state the band or re-issue the verdict.
- The merchants already named in the first Read.
- The unresolved-transaction clarifiers (the first Read's hook into the Value Map) — their job is DONE. Do not pose them again.

BANNED IN THE RECOMPOSE:
- Re-opening on Layer 1 (income / fixed / FCF / "the clock is running").
- Re-delivering the goal math: the monthly contribution figure, the compound-growth band, or a fresh "is this realistic" verdict. The first Read settled these — this turn builds on them, it does not repeat them.
- Echoing the user's classification back as if it were a finding ("you called X an investment, so it's an investment"). State what the sort now makes visible, never the sort by itself.
- Re-explaining a merchant the user just sorted as if it were a new finding.
- Re-posing the first Read's clarifier hook — the unresolved-transaction questions.
- Any paragraph ending in a question back to the user.
- "What do you think?" / "Does that sound right?" closes.
- The words "advice" or "advise" anywhere.
- Emoji. Product names or buy/sell/switch calls.
- Inventing magnitudes — every number comes verbatim from the DATA below.

BOUNDARY (felt, not stated):
If you reference the goal, a contribution figure stays a calculation ("the goal needs €948/mo"), never an instruction to fund a product ("put €948 into a fund"). Naming the user's own goal vehicle is fine; phrasing a calculation as a directed flow into a product is not. No disclaimers, no apologies — if a topic sits outside the remit, the close just doesn't go there.

HONESTY (NO HALLUCINATION):
- Use only the dates, amounts, merchants, and patterns from the structured data below. Do not invent any of these.
- Never attribute a transaction to today's date. The data is a snapshot.
- Cluster totals and transaction counts MUST come from the "volume" line in BEHAVIOURAL CLUSTERS. Never compute a sum yourself.
- Proportions and percentages come verbatim from SPENDING BREAKDOWN. When category coverage is low (a large uncategorised share), DO NOT state a total-spend % you can't support — lead on named-merchant proportions and absolute amounts instead.
- Income, fixed costs, and free cash flow come from FINANCIAL FACTS verbatim — never recompute them.

LENGTH & FORMAT: hard cap 200 words (tighter than the first Read — it's a delta). Plain prose. Bold (**) merchant names on first mention. CTA on its own line before "— C.". Sign off "— C." on its own line.

SHAPE TO AIM FOR (illustrative of the SHAPE only — never copy these figures or merchants; the DATA below is the real source):
> Your sort just made the shape legible. Of everything you classified, **eating out** is the one thing you called a Leak that's also big enough to move the goal — that's the lever, and now it carries your own label.
> The two you marked Foundation — **Sainsbury's** and rent — are exactly what's holding steady; the slack is all in the Leak column. What's still in the dark is the third of your spend that's uncategorised — clear that and the read is clean.
> Start with the eating-out leak. That's where the room is.
> [CTA:open_chat]Let's trim the eating-out leak[/CTA]
> — C.

Notice what the shape does and does NOT do: it LEADS on what the sort revealed, references the goal only as a frame ("big enough to move the goal" — no contribution figure, no band, no verdict), pairs every sort with the new thing it makes visible (never "you called it X so it's X"), names the one remaining unknown, and lands ONE action before the handoff.`;

/**
 * Reality-check variant (OB-3) — the Read delivered after the optional
 * statement-check mission. The user has now uploaded a real month, and the
 * deterministic delta engine (estimates/deltas.ts) has checked every ≈ estimate
 * against the real number. This Read leads on the estimate-vs-reality gap, gives
 * the corrected position on real figures, and closes by handing into the Value
 * Map (the VM-3 convergence). It inherits the value-first voice + honesty blocks;
 * only the STRUCTURE and CLOSE differ.
 */
export const FIRST_READ_SYSTEM_PROMPT_REALITY_CHECK = `You are the user's CFO. Earlier you wrote them a Read built entirely from their own estimates — a sketch. They have now uploaded a real month (or more) of statements, and the system has checked each estimate against the real number. This message is the payoff: estimate vs reality, side by side. It is honest, specific, and lands the user somewhere better than the sketch left them. Sign off "— C." on its own line.

WHAT CHANGED SINCE THE SKETCH:
- The earlier figures were the user's guesses, written with "≈". You now have REAL numbers for the bands the statement could verify. Lead with the gap between the two.
- The ESTIMATE VS REALITY block below gives you, per band: the estimate (≈), the real number, the delta, and whether the guess HELD or was off. Some bands are still ESTIMATES (the upload couldn't isolate them) — those are flagged; keep them as ≈ estimates, never as checked facts.

STRUCTURE (this is the contract — DELTAS, then the corrected position, then clarifiers, then the handoff):
1. DELTAS — open on the SHARPEST band from ESTIMATE VS REALITY (the biggest miss): "You guessed ≈X eating out. The real number was Y." Then at most one or two more deltas, in EITHER direction — a guess that came in under reality is as worth naming as one that came in over. Where a guess HELD, say so plainly ("your rent guess was on the money"). Where a band is still an ESTIMATE, keep it ≈ and name it as not-yet-checked; never present it as confirmed. If a save-reach note is given, quote it VERBATIM. If there is NO sharpest miss (every verified guess held), open on that — the sketch held up — and name which bands the month confirmed. If the upload couldn't verify ANY band, say plainly the real numbers are in but still settling, and move to the handoff.
2. CORRECTED POSITION — restate where they now stand on REAL numbers: free cash flow and the goal's monthly pace, from FINANCIAL FACTS and GOAL verbatim. Reference the sketch's figures only as the contrast ("your sketch said ≈X; the real free cash is Y"). Do NOT recompute anything — quote the numbers you were handed. If the goal math gives a compound-growth band, show the range once then LOCK the moderate middle case as the plan, and treat the conservative case as the stress test.
3. CLARIFIERS — one or two things the data still can't settle on its own, posed as DIRECT either/or questions on the HOOK CANDIDATES (cite merchant, amount, period_hint verbatim). If there are no hook candidates, skip this beat.
4. HANDOFF — two beats: (a) name plainly that the habits half of the picture is now FILLABLE — timing, what's recurring, the patterns the sketch couldn't see — but that what those patterns MEAN to the user is still missing, and the Value Map is where that intent attaches; (b) the knows-you line VERBATIM from the KNOWS-YOU block, then the CTA on its own line immediately before "— C.": [CTA:start_value_map_real]Tell me what these mean[/CTA].

BANNED IN THE READ:
- Presenting a band still marked ≈ / not-verified as observed or confirmed.
- Inventing a real number for a band the ESTIMATE VS REALITY block left as an estimate.
- Narration of observing: "I see", "I notice", "On reviewing". State what's true.
- Surfacing a figure only to disclaim it past the honest "this band's still an estimate" framing.
- A vague question-back close: "What do you think?" / "Does that sound right?". (The CLARIFIERS are specific either/or questions — those are the point, not banned.)
- Apology or boundary-stating language: "unfortunately", "I'm not able to advise", "I can't recommend", "sorry".
- Emoji. The words "advice" or "advise" anywhere.
- Product names or buy/sell/switch calls on instruments.
- Inventing magnitudes. Every number comes verbatim from the blocks below.
- More than one CTA, or a CTA other than [CTA:start_value_map_real].

BOUNDARY (felt, not stated):
Directness applies to behaviour and cash flow — name the gap, size the move, point to the next step. A contribution figure is a calculation ("the goal needs €420/mo"), never an instruction to fund a product. No disclaimers, no apologies.

VOICE (Constitution v1.4 §2):
- State findings directly. "Eating out ran €287 a month — €137 over your guess." Don't narrate the act of observing.
- Plain English, short sentences, warm authority — not a service desk ("Let me…", "I can help…").
- Second person for the user's facts. First person only when it carries a real stance.

HONESTY (NO HALLUCINATION):
- Use only the numbers, merchants, and patterns from the blocks below. Do not invent any of them.
- Real deltas come from ESTIMATE VS REALITY verbatim; the ≈ figures are the user's old guesses — never recompute either.
- Income, fixed costs, and free cash flow come from FINANCIAL FACTS verbatim.
- Cluster totals and counts come from the "volume" line in BEHAVIOURAL CLUSTERS. Never compute a sum yourself.
- If DATA RECENCY shows the data is stale, acknowledge it in the first or second line.
- Cite only day-counts and date spans that appear verbatim below.

LENGTH & FORMAT:
- Target 120–220 words. Tight — a few short paragraphs, not an essay.
- Plain prose. Bold (**) the band / cluster names when first mentioned. The clarifiers may sit as up to two short dashed lines.
- The CTA is on its own line, immediately before "— C.".
- Sign off "— C." on its own line.`;

export function buildFirstReadUserPrompt(input: FirstReadComposeInput): string {
  const isRecompose = input.priorReadSummary != null;
  const isRealityCheck = input.deltas != null;
  // Reality-check passes hook candidates too (for its CLARIFIERS), so exclude it
  // from the value-first branch — it has its own STRUCTURE + close contract.
  const isValueFirst = !isRealityCheck && (input.hookCandidates?.length ?? 0) > 0;
  const currency = input.financialFacts?.currency ?? 'EUR';
  const symbol = currencySymbol(currency).trim() || currency;
  const sections: string[] = [
    `CURRENCY: All amounts are in ${currency}. Always format money with "${symbol}" — never use any other currency symbol (e.g. never £ or $ unless that IS the symbol above).`,
    ``,
    `DATA RECENCY:`,
    formatDataRecency(input),
    ``,
    `TRANSACTION CONTEXT:`,
    `- Total transactions: ${input.transactionCountTotal}`,
    input.coveredDays != null && input.coveredDays > 0
      ? `- Data coverage: ${input.coveredDays} day${input.coveredDays === 1 ? '' : 's'} of activity${input.dataWindowStart ? ` (${input.dataWindowStart} → ${input.dataWindowEnd ?? 'latest'})` : ''}.`
      : `- Window length: ${input.windowDays} days`,
    ``,
    `DATA SUFFICIENCY (how much history this Read stands on — obey before stating any "/mo" rate, trend, or recurrence):`,
    formatDataSufficiency(input),
    ``,
    `VALUE PROFILE (Stated Intent — what the user said in the Value Map):`,
    formatValueProfile(input.valueProfile),
    ``,
    isRecompose
      ? `GOAL (ALREADY DELIVERED in the first Read — the target, the monthly contribution figure, and the compound-growth band were all stated. Reference the goal as an established frame, in a clause at most; do NOT restate the band or re-issue a verdict):`
      : `GOAL:`,
    input.goalSummary ?? '(none set yet)',
    ``,
    `FINANCIAL FACTS (Layer 1 — confirmed, server-computed; cite verbatim, do not recompute):${isRecompose ? ' [ALREADY DELIVERED in the first Read — context only; do not re-open on income / fixed costs / FCF.]' : ''}`,
    formatFinancialFacts(input.financialFacts, currency),
    ``,
    `SPENDING BREAKDOWN (Layer 1 — server-computed; cite verbatim, never recompute a % or a sum):`,
    formatSpendingBreakdown(input.spendingBreakdown, currency),
    ``,
  ];

  // Reality-check mode: the estimate-vs-reality deltas are the spine of the Read.
  // Rendered right after the Layer-1 facts so the model leads on the gap.
  if (isRealityCheck) {
    sections.push(
      `ESTIMATE VS REALITY (OB-3 — the system checked each ≈ estimate against the real month; cite these verbatim, never recompute a real number or invent one for an unverified band):`,
      formatDeltas(input.deltas, currency),
      ``,
    );
  }

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
    // Reality-check closes on the Value-Map hook CTA too, so suppress the
    // blocker's supply_input CTA just as the value-first path does.
    formatBlocker(input.blocker, isValueFirst || isRealityCheck),
    ``,
    `LEVERS (computed magnitudes — frame these numbers, do not invent them):`,
    formatLevers(input.levers),
    ``,
  );

  // Both value_first and reality_check render HOOK CANDIDATES — but as
  // CLARIFIERS (direct either/or questions mid-Read), NOT as the closing hook.
  // The two modes' COMPOSE directives below diverge on everything else.
  if (isValueFirst || isRealityCheck) {
    sections.push(
      `HOOK CANDIDATES (the 1-2 things the data can't settle — pose these as direct CLARIFIER questions, not a closing hook):`,
      formatHookCandidates(input.hookCandidates ?? [], currency),
      ``,
    );
  }

  if (isRealityCheck && input.knowsYouLine) {
    sections.push(
      `KNOWS-YOU (reproduce this line VERBATIM in the HANDOFF, immediately before the CTA — it is the single sanctioned user-visible percentage):`,
      input.knowsYouLine,
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
    isRecompose
      ? formatRecomposeReadFocus(input.readRecipe ?? 'open')
      : formatReadFocus(input.readRecipe ?? 'open', input.goalSummary),
    ``,
    `BEHAVIOURAL CLUSTERS (top observations from their actual transactions):`,
    input.topClusterBehaviours.length === 0
      ? '(no clusters with sufficient data — fall back to the transaction count and acknowledge the thin data)'
      : input.topClusterBehaviours
          .map((b) => formatClusterForPrompt(b, currency, input.effectiveMonths, input.coveredDays))
          .join('\n\n'),
    ``,
    isRealityCheck
      ? `COMPOSE THE REALITY-CHECK READ NOW. Open on the SHARPEST delta from ESTIMATE VS REALITY, name ≤2 more deltas (either direction; say where the guess held; keep unverified bands as ≈ estimates and never claim they were checked; quote any save-reach note verbatim), then the CORRECTED POSITION on real free cash + goal pace (FINANCIAL FACTS / GOAL verbatim, the sketch's ≈ figures only as the contrast), then 1-2 CLARIFIERS as direct either/or questions on the HOOK CANDIDATES (skip the beat if there are none), then the HANDOFF: the habits half is now fillable but what those patterns MEAN still needs the Value Map, the knows-you line VERBATIM, and the [CTA:start_value_map_real]Tell me what these mean[/CTA] line. Output the composed message text only — no markdown code fences, no preamble. Sign off with "— C." on its own line.`
      : isRecompose
      ? `COMPOSE THE RECOMPOSE NOW. Lead on what their sorting unlocked per READ FOCUS, ≤2 delta observations from the NEW Layer 2 (WHAT THE USER JUST SORTED), close on a directive + [CTA:open_chat]…[/CTA] that lands them in chat. Do not restate anything in ALREADY SAID. Do not open a new hook. Hard cap 200 words. Output the message text only — no markdown code fences, no preamble. Sign off with "— C." on its own line.`
      : isValueFirst
      ? `COMPOSE THE FIRST READ NOW. POSITION on free cash flow + the goal math per READ FOCUS, then ONE ACTION quantified against the goal gap (a sized LEVERS trim on the biggest discretionary category from SPENDING BREAKDOWN), then 1-2 CLARIFIERS as direct either/or questions on the HOOK CANDIDATES, then close by naming the next levers as headlines, positioning the Value Map as where they get prioritised, and the [CTA:start_value_map_real]Tell me what these mean[/CTA] line. Output the composed message text only — no markdown code fences, no preamble, no explanation. Sign off with "— C." on its own line.`
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
    v == null ? null : formatMoney(Math.round(v), currency);
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
  // Whole-currency rounding (cents read like a spreadsheet) + human category
  // labels (never the raw slug — "eating & drinking out", not "eat_drinking_out").
  const m = (v: number) => formatMoney(Math.round(v), currency);
  const lines: string[] = [];
  lines.push(`- Total tracked spend (window): ${m(breakdown.total_spend)}`);
  lines.push(
    `- Top categories: ` +
      breakdown.top_categories
        .map((c) => `${categoryLabel(c.category)} ${m(c.total)} (${c.pct}%)`)
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
        `language and show the range once, then LOCK the moderate middle case (the rate the GOAL block`,
        `flags) as the plan, size the verdict against it, and treat the conservative case as the stress`,
        `test, not the default. If the target`,
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

/**
 * Recompose LEAD focus. The first Read already delivered Layer 1 AND the goal math
 * (target, monthly contribution, compound band, verdict — see ALREADY SAID). The
 * recompose must NOT re-lead on either. Under every recipe it leads on the DELTA
 * the sort created — what the new Layer 2 makes visible — and references the goal
 * only as an established frame. This is the fix for the redundancy where the
 * shared `formatReadFocus('target')` re-invited the €/mo contribution band into a
 * turn whose whole job is to NOT repeat it.
 */
function formatRecomposeReadFocus(recipe: ReadRecipe): string {
  switch (recipe) {
    case 'target':
      return [
        `The goal, its target, and the monthly contribution band were delivered in the first Read.`,
        `Do NOT re-lead on them or restate the band/verdict. LEAD on what the sort now reveals about`,
        `the goal: which of their own classified spends is holding the plan up vs pulling against it.`,
        `Reference the contribution figure only as an established frame, in a clause at most.`,
      ].join('\n');
    case 'visibility':
      return [
        `LEAD on the picture the sort just made legible: the proportion of spend now accounted for and`,
        `where it concentrates (named-merchant proportions / absolute amounts when category coverage`,
        `is low). The standing Layer 1 facts are already said — build past them, don't restate them.`,
      ].join('\n');
    case 'control':
      return [
        `LEAD on the biggest drain now that intent is attached to it — the spend they themselves marked`,
        `a Leak or Burden that the trajectory confirms. Layer 1 and the goal math are already said.`,
      ].join('\n');
    case 'open':
    default:
      return [
        `LEAD on the single sharpest thing the new classifications reveal — the call that most changes`,
        `the picture. The standing facts are already said; do not re-open on them.`,
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
        `   - recent amount (window): ${formatMoney(Math.round(h.recent_amount), currency)}`,
        `   - pattern hint: ${h.period_hint}`,
        `   - candidate quadrants: ${h.candidate_quadrants.join(' | ')}`,
      ].join('\n');
    })
    .join('\n');
}

/** Human band labels for the ESTIMATE VS REALITY block — never the engine ids. */
const DELTA_BAND_LABELS: Record<BandDelta['band'], string> = {
  housing: 'housing',
  subscriptions: 'subscriptions',
  bills: 'bills',
  food_out: 'eating out',
  save_reach: 'what you could set aside',
};

/**
 * Render the estimate-vs-reality deltas for the reality-check Read. Every figure
 * is taken verbatim from the pure delta engine (computeDeltas) — the model cites
 * these, it never recomputes a delta. Bands fall into four buckets: the sharpest
 * miss (the lead), other verified misses, bands where the guess held, and bands
 * the upload couldn't verify (which stay ≈ estimates).
 */
function formatDeltas(deltas: DeltaResult | null | undefined, currency: string): string {
  if (!deltas) return '(no verification available)';
  const m = (v: number) => formatMoney(Math.round(v), currency);
  const signed = (v: number) => `${v >= 0 ? '+' : ''}${m(v)}`;
  const lines: string[] = [];

  if (deltas.sharpest) {
    const s = deltas.sharpest;
    const d = s.delta ?? 0;
    lines.push(
      `SHARPEST MISS (open on this): ${DELTA_BAND_LABELS[s.band]} — guessed ≈${m(s.estimate)}, real ${m(s.actual ?? 0)} (${signed(d)}, ${d > 0 ? 'higher than' : 'lower than'} the guess).`,
    );
  }

  // Other verified misses (the sharpest is already shown above).
  for (const b of deltas.bands) {
    if (b.state !== 'verified' || b.held !== false) continue;
    if (b.band === deltas.sharpest?.band) continue;
    lines.push(
      `- MISS: ${DELTA_BAND_LABELS[b.band]} — guessed ≈${m(b.estimate)}, real ${m(b.actual ?? 0)} (${signed(b.delta ?? 0)}).`,
    );
  }

  // Bands where the guess held — say so plainly.
  for (const b of deltas.held) {
    lines.push(
      `- HELD (guess was close — say so): ${DELTA_BAND_LABELS[b.band]} — guessed ≈${m(b.estimate)}, real ${m(b.actual ?? 0)}.`,
    );
  }

  // Bands the upload couldn't verify — keep them ≈ estimates.
  for (const b of deltas.bands) {
    if (b.state !== 'estimated') continue;
    lines.push(
      `- STILL AN ESTIMATE (couldn't verify from this upload — keep it ≈, don't claim it was checked): ${DELTA_BAND_LABELS[b.band]} — ≈${m(b.estimate)}.`,
    );
  }

  // Save-reach proxy note, quoted verbatim if present.
  const saveReach = deltas.bands.find((b) => b.band === 'save_reach');
  if (saveReach?.note) {
    lines.push(
      `- NOTE on what you could set aside: "${saveReach.note}" — quote this verbatim when you cite that figure.`,
    );
  }

  return lines.length > 0
    ? lines.join('\n')
    : '(every band is still an estimate — no real numbers to compare yet)';
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
      `- This sets the POSITION only. The CLOSE remains the Value Map handoff and its [CTA:start_value_map_real] line; the hook items are the CLARIFIERS — do not emit a supply_input CTA.`,
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

function monthName(isoDate: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return 'that month';
  return d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
}

/**
 * Data-sufficiency guidance keyed off ACTUAL coverage (not the fixed 90d window).
 * A single month of data can't establish monthly averages, trends, or recurrence,
 * so the Read must say so and frame per-month figures as that one month — never a
 * settled rate. Without this the Read stated "$X a month" off one month of data
 * and never acknowledged the limitation.
 */
function formatDataSufficiency(input: FirstReadComposeInput): string {
  const days = input.coveredDays;
  if (days == null || days <= 0) {
    return '- Coverage unknown — keep figures qualitative; do not state monthly averages or trends.';
  }
  const months = input.monthsSpanned ?? Math.max(1, Math.round(days / DAYS_PER_MONTH));
  const single = months <= 1 || days < 45;
  const limited = !single && days < 75;
  const monthLabel = input.dataWindowStart ? monthName(input.dataWindowStart) : 'that month';

  if (single) {
    return [
      `- THIS IS A SINGLE MONTH OF DATA (${days} days). Acknowledge it explicitly in the first or second line — the user gave you one month, not a representative picture.`,
      `- Every per-month figure below is THAT ONE MONTH's spend, not an established average. Frame it as "in ${monthLabel}" or "over the one month on file" — never as a settled "/mo" rate to bank on.`,
      `- Do NOT label any merchant "recurring", "weekly", or "monthly", and do NOT assert a trend (rising/falling): one month cannot establish recurrence or direction. Where recurring-vs-one-off matters, ASK it — that is what the clarifiers are for.`,
    ].join('\n');
  }
  if (limited) {
    return `- This is roughly ${months} months of data (${days} days) — a provisional read, not settled averages. Hedge per-month figures ("running around …") and treat any trend as tentative, not established.`;
  }
  return `- ${days} days of data across ~${months} months — enough for monthly figures and basic trend/recurrence reads.`;
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
    lines.push(`- The clarifier hook (unresolved-transaction questions) already ran on: ${prior.hookMerchantsUsed.join(', ')}. Its job is DONE — do not pose them again.`);
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

function formatClusterForPrompt(
  b: ClusterBehaviour,
  currency: string,
  effectiveMonths?: number | null,
  coveredDays?: number | null,
): string {
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
  // Per-month equivalent off ACTUAL data coverage (floored at 1 month), not the
  // fixed window — a one-month upload divided by the 90d window understated this
  // ~3x. Falls back to the cluster's own window when coverage isn't supplied. The
  // span label likewise reflects real coverage so "over 90d" can't imply data we
  // don't have.
  const months =
    effectiveMonths != null && effectiveMonths > 0
      ? Math.max(1, effectiveMonths)
      : b.window_days > 0
        ? b.window_days / DAYS_PER_MONTH
        : null;
  const perMonth = months != null && months > 0 ? total / months : null;
  const spanDays = coveredDays != null && coveredDays > 0 ? coveredDays : b.window_days;
  // On a single month of data, recurrence/cadence isn't established — drop the
  // "prefer the /mo figure" nudge so the DATA SUFFICIENCY caveat governs framing.
  const thin = coveredDays != null && coveredDays > 0 && coveredDays < 45;
  const isRecurring =
    !thin &&
    (b.recurrence.pattern_label === 'monthly' || b.recurrence.pattern_label === 'weekly');
  lines.push(
    `- volume: ${b.transaction_count} txns totalling ${formatMoney(Math.round(total), currency)} over ${spanDays}d` +
      (perMonth != null
        ? ` (≈ ${formatMoney(Math.round(perMonth), currency)}/mo${isRecurring ? ' — recurring, prefer the /mo figure' : ''})`
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
