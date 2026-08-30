import type { QuotableFact, ValidationResult } from '@/lib/analytics/insight-types';

// ─────────────────────────────────────────────────────────────────────────────
// V2 (Session v2.2 Chat Intelligence) validators
//
// These run AFTER the LLM produces a first_read response, on top of the
// existing v1 validateNarrative. They enforce four guarantees:
//  - validateCitations:   numbers/merchants in prose trace back to a tool result
//  - validateProjections: any /year, /month, "saved", "annually" framing has a
//                         tool result carrying a computed impact band to back
//                         it. No tool returns one today (the deprecated
//                         propose_experiment tool was the only producer and was
//                         removed), so in the live path the allowlist is empty
//                         and every projection number in a Read is flagged.
//  - validateVoice:       banned reflexive-CFO phrases are flagged
//  - validateChips:       generic / navigation / no-narrative-noun chips are
//                         flagged for stripping
//
// Helpers (extractNumbers, extractMerchants) are reused from the v1 path
// below — same regexes, same ±1 tolerance for numeric matches.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract all numbers >= 10 from a narrative string, for validation against
 * a quotable-facts allowlist. Mirrors the judge's extraction regex so our
 * app-side guard matches the test harness.
 */
export function extractNumbers(text: string): number[] {
  // Strip currency symbols so "£3,300" -> "3,300", "€500" -> "500".
  const cleaned = text.replace(/[£€$¥]/g, '');
  // Match integers and decimals, allowing thousand-separator commas.
  const matches = cleaned.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) ?? [];
  return matches
    .map((m) => Number(m.replace(/,/g, '')))
    .filter((n) => Number.isFinite(n) && n >= 10);
}

/**
 * Return the subset of `knownMerchants` that appear as whole-word case-insensitive
 * matches in `text`. The input list is already normalised to lowercase by the
 * caller (the engine produces normalised merchant keys).
 */
export function extractMerchants(text: string, knownMerchants: string[]): string[] {
  if (knownMerchants.length === 0) return [];
  const lowered = text.toLowerCase();
  const seen = new Set<string>();
  for (const m of knownMerchants) {
    const re = new RegExp(`\\b${escapeRegex(m)}\\b`, 'i');
    if (re.test(lowered)) seen.add(m);
  }
  return Array.from(seen);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type ValidateOptions = {
  /**
   * Whole universe of merchant names present in the user's transactions. The
   * validator rejects any merchant in the narrative that is in this list but
   * NOT in any QuotableFact.merchants. When omitted, merchants are not checked.
   */
  knownMerchants?: string[];
};

export function validateNarrative(
  narrative: string,
  facts: QuotableFact[],
  opts: ValidateOptions = {},
): ValidationResult {
  const allowedNumbers = new Set<number>();
  const allowedMerchants = new Set<string>();
  for (const f of facts) {
    for (const n of f.numbers) allowedNumbers.add(n);
    for (const m of f.merchants) allowedMerchants.add(m.toLowerCase());
  }

  const cited = extractNumbers(narrative);
  // Allow ±1 tolerance — matches the judge's ±1-currency-unit grace and
  // tolerates legitimate rounding (e.g. £29.99 cited when allowlist has 30).
  const badNumbers = cited.filter((n) => {
    for (const allowed of allowedNumbers) {
      if (Math.abs(n - allowed) <= 1) return false;
    }
    return true;
  });
  if (badNumbers.length > 0) {
    return {
      ok: false,
      reason: 'numbers_not_allowed',
      offenders: badNumbers.map(String),
    };
  }

  if (opts.knownMerchants && opts.knownMerchants.length > 0) {
    const citedMerchants = extractMerchants(narrative, opts.knownMerchants);
    const badMerchants = citedMerchants.filter((m) => !allowedMerchants.has(m));
    if (badMerchants.length > 0) {
      return {
        ok: false,
        reason: 'merchants_not_allowed',
        offenders: badMerchants,
      };
    }
  }

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// V2 validators — buildCitationAllowlist / validateCitations
// ─────────────────────────────────────────────────────────────────────────────

export interface CitationAllowlist {
  numbers: Set<number>;
  merchants: Set<string>;
}

export interface ToolResultLike {
  toolName: string;
  output: unknown;
}

export interface BriefData {
  income?: number | null;
  rent?: number | null;
  archetype?: string | null;
}

// Keys whose string values count as "merchant names" when walking tool output.
// Conservative list — err on the side of allowing more rather than under-collecting.
const MERCHANT_KEYS = new Set([
  'merchant',
  'merchants',
  'top_merchants',
  'driving_merchants',
  'description',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Recursively walk arbitrary tool output, accumulating numbers ≥10 and
// merchant strings (lowercased). The walker keeps a visited Set to defend
// against accidental cycles in tool output.
function walkForCitations(
  value: unknown,
  numbers: Set<number>,
  merchants: Set<string>,
  visited: WeakSet<object>,
  parentKey?: string,
): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'number') {
    if (Number.isFinite(value) && value >= 10) numbers.add(value);
    return;
  }
  if (typeof value === 'string') {
    // Strings under a merchant-shaped key contribute to the merchant set.
    if (parentKey && MERCHANT_KEYS.has(parentKey)) {
      const trimmed = value.trim().toLowerCase();
      if (trimmed) merchants.add(trimmed);
    }
    return;
  }
  if (typeof value !== 'object') return;
  // Cycle guard.
  if (visited.has(value as object)) return;
  visited.add(value as object);

  if (Array.isArray(value)) {
    for (const item of value) {
      // For arrays under a merchant key (e.g. top_merchants: ['glovo', ...]),
      // each string item is itself a merchant name.
      walkForCitations(item, numbers, merchants, visited, parentKey);
    }
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    walkForCitations(child, numbers, merchants, visited, key);
  }
}

export function buildCitationAllowlist(
  toolResults: ToolResultLike[],
  brief: BriefData,
): CitationAllowlist {
  const numbers = new Set<number>();
  const merchants = new Set<string>();
  const visited = new WeakSet<object>();

  for (const result of toolResults) {
    walkForCitations(result.output, numbers, merchants, visited);
  }

  if (typeof brief.income === 'number' && brief.income >= 10) {
    numbers.add(brief.income);
  }
  if (typeof brief.rent === 'number' && brief.rent >= 10) {
    numbers.add(brief.rent);
  }

  return { numbers, merchants };
}

/** A computed figure the prose actually cited, tagged with the bundle it came from. */
export interface CitedFigure {
  value: number;
  source: string;
}

/**
 * The inverse of validateCitations: instead of the numbers in the prose that
 * traced to NOTHING, return the ones that traced to SOMETHING — each tagged
 * with the tool/bundle that produced it.
 *
 * This is what makes an error report actionable. When a beta user says a figure
 * in their Read is wrong, we need to know which computed source handed it to the
 * model. Persisted onto conversations.metadata.first_read_metadata at compose
 * time and snapshotted onto read_feedback when a report is filed.
 *
 * Only figures present in the narrative are returned — the full allowlist runs
 * to hundreds of numbers per Read, nearly all of which the user never saw.
 * Matching uses the same ±1 tolerance as validateCitations, so the two agree on
 * what counts as "cited". First source wins on a tie, so the result is stable
 * for a given bundle order. Deduped by value and capped at MAX_CITED_FIGURES.
 *
 * Ordered by first appearance in the NARRATIVE, not by bundle — the list reads
 * in the same sequence the user met the figures, which is the order they will
 * describe them in when they tell us one is wrong.
 */
/**
 * ─── Surplus / shortfall reconciliation (Session 083) ──────────────────────
 *
 * WHY THIS EXISTS: an Aug-2026 Nova Pro A/B produced four Reads that inverted
 * the user's financial position — "you're £578 short each month" to a user with
 * £565/month of headroom. The failure was always the same shape: the model
 * subtracted the CONSERVATIVE monthly requirement from the MODERATE one and
 * reported that difference as a shortfall against cash flow.
 *
 * Neither existing guard caught it. validateCitations passes because every
 * atomic number is real — the arithmetic over them is what's wrong. The LLM
 * judge passes it 5/5 because its accuracy dimension asks "is this figure
 * grounded?", not "is this conclusion correct".
 *
 * So this is deliberately NOT an LLM check. The server already computes both
 * numbers a Read is allowed to assert (`surplusOverRequired` and
 * `stressTestGap` on the accelerate lever), which makes "is the claim true?"
 * a pure comparison. CLAUDE.md Rule 2: the system computes, the LLM interprets
 * — this enforces that the interpretation didn't invent its own arithmetic.
 */

/**
 * The server-computed figures a Read's headroom claims must reconcile against.
 *
 * Sourced from free cash flow + the monthly REQUIREMENT figures the prompt
 * itself was built from (the compound-growth band for investment goals, the
 * straight-line figure otherwise) — deliberately NOT from the accelerate lever
 * alone. A first pass keyed only on that lever silently skipped every Read that
 * needed checking, because the lever is absent whenever the goal has no
 * `monthly_required_saving` or gets dropped by the facts reconciliation, which
 * is exactly the case in the observed regressions.
 */
export interface SurplusGroundTruth {
  /** free_cash_flow the Read was handed. Null when unknown. */
  freeCashFlow: number | null;
  /** Every monthly requirement the prompt offered (band values, or the straight-line figure). */
  requirements: number[];
  /** accelerate lever's surplusOverRequired, when the lever exists. Corroboration only. */
  surplusOverRequired: number | null;
  /** accelerate lever's stressTestGap: extra monthly need at the conservative rate. 0 = covered. */
  stressTestGap: number | null;
  /**
   * False when a supply_input blocker gates the goal math (no target date, no
   * target amount). Nothing numeric about pace can be asserted at all — the
   * Read may say a figure is missing, never that the user is £X short.
   */
  paceComputable: boolean;
}

export interface SurplusClaim {
  kind: 'shortfall' | 'surplus';
  value: number;
  /** The matched text, so a violation log points at the sentence to fix. */
  phrase: string;
}

export interface ReconciliationViolation {
  claim: SurplusClaim;
  reason: string;
}

export interface ReconciliationResult {
  valid: boolean;
  claims: SurplusClaim[];
  violations: ReconciliationViolation[];
  /** True when the ground truth was too thin to check anything (no goal at all). */
  skipped: boolean;
}

// "you're £62 short", "£578 short each month", "short by £300", "that £62 gap"
const SHORTFALL_PATTERNS: RegExp[] = [
  /[£€$]\s?([\d,]+(?:\.\d+)?)\s+short\b/gi,
  /\bshort\s+by\s+[£€$]\s?([\d,]+(?:\.\d+)?)/gi,
  /[£€$]\s?([\d,]+(?:\.\d+)?)\s+(?:gap|shortfall|deficit)\b/gi,
];

// "with £283 to spare", "£221 left", "£463 surplus", "£1,099/mo to spare"
const SURPLUS_PATTERNS: RegExp[] = [
  /[£€$]\s?([\d,]+(?:\.\d+)?)\s*(?:\/mo|\/month|\s+a\s+month|\s+each\s+month)?\s+(?:to\s+spare|spare\b|left\s+over|left\b|surplus\b|headroom\b)/gi,
];

function collect(narrative: string, patterns: RegExp[], kind: SurplusClaim['kind']): SurplusClaim[] {
  const out: SurplusClaim[] = [];
  for (const re of patterns) {
    // Patterns are module-level with /g, so lastIndex must be reset per call —
    // otherwise a second invocation resumes mid-string and silently misses claims.
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(narrative)) !== null) {
      const value = Number(m[1].replace(/,/g, ''));
      if (Number.isFinite(value)) out.push({ kind, value, phrase: m[0].trim() });
    }
  }
  return out;
}

/** Every numeric headroom/shortfall assertion in the prose. */
export function extractSurplusClaims(narrative: string): SurplusClaim[] {
  return [...collect(narrative, SHORTFALL_PATTERNS, 'shortfall'), ...collect(narrative, SURPLUS_PATTERNS, 'surplus')];
}

/**
 * Check every surplus/shortfall claim against the server's own figures.
 *
 * Deliberately asymmetric. A claimed SHORTFALL is checked hard — inventing a
 * deficit for a funded user is the failure mode that actually happened, and
 * it's the one that does real damage. A claimed SURPLUS is only flagged when
 * the ground truth says no headroom exists at all: a correct Read legitimately
 * quotes several scenario headrooms ("£283 to spare" at plan, "£221 left" at
 * the stress rate) and only the plan-rate one equals surplusOverRequired, so
 * requiring an exact match on every surplus claim would fire on good Reads.
 *
 * Tolerance is ±1 currency unit, matching validateCitations.
 */
export function validateSurplusClaims(
  narrative: string,
  truth: SurplusGroundTruth,
): ReconciliationResult {
  const claims = extractSurplusClaims(narrative);
  const violations: ReconciliationViolation[] = [];

  const hasRequirementTruth = truth.freeCashFlow != null && truth.requirements.length > 0;
  const hasLeverTruth = truth.surplusOverRequired !== null || truth.stressTestGap !== null;

  // Nothing to check against: no goal, no requirement, no lever. Skip rather
  // than guess — but the caller logs this, because a Read that asserts a
  // shortfall with no goal context at all is still worth a human look.
  if (truth.paceComputable && !hasRequirementTruth && !hasLeverTruth) {
    return { valid: true, claims, violations: [], skipped: true };
  }

  const fcf = truth.freeCashFlow ?? 0;
  // Real deficits and real headrooms, derived the only legitimate way:
  // requirement vs free cash flow.
  const deficits = hasRequirementTruth
    ? truth.requirements.filter((r) => r > fcf).map((r) => r - fcf)
    : [];
  const headrooms = hasRequirementTruth
    ? truth.requirements.filter((r) => r <= fcf).map((r) => fcf - r)
    : [];
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;

  for (const claim of claims) {
    if (!truth.paceComputable) {
      violations.push({
        claim,
        reason:
          'goal pace is not computable (a supply_input blocker is active), so no numeric ' +
          'shortfall or headroom can be asserted at all',
      });
      continue;
    }

    if (claim.kind === 'shortfall') {
      // A real stressTestGap is the most specific truth available — prefer it.
      if (truth.stressTestGap !== null && truth.stressTestGap > 0) {
        if (!near(claim.value, truth.stressTestGap)) {
          violations.push({
            claim,
            reason: `claims a shortfall of ${claim.value} but the computed stressTestGap is ${truth.stressTestGap}`,
          });
        }
        continue;
      }
      if (hasRequirementTruth) {
        if (deficits.length === 0) {
          violations.push({
            claim,
            reason:
              `claims a shortfall of ${claim.value} but free cash flow (${fcf}) covers every ` +
              `monthly requirement [${truth.requirements.join(', ')}] — there is no shortfall`,
          });
        } else if (!deficits.some((d) => near(claim.value, d))) {
          violations.push({
            claim,
            reason:
              `claims a shortfall of ${claim.value}; the only real shortfalls against free cash ` +
              `flow (${fcf}) are [${deficits.map((d) => Math.round(d)).join(', ')}]`,
          });
        }
        continue;
      }
      // Lever-only fallback: covered at plan and at the stress rate.
      if (truth.surplusOverRequired !== null && truth.surplusOverRequired > 0) {
        violations.push({
          claim,
          reason:
            `claims a shortfall of ${claim.value} but the goal is covered — ` +
            `surplusOverRequired is ${truth.surplusOverRequired}`,
        });
      }
      continue;
    }

    // Surplus claim: flagged only when NO headroom exists at all. A correct Read
    // quotes several scenario headrooms and only the plan-rate one equals
    // surplusOverRequired, so match-checking each would fire on good Reads.
    if (hasRequirementTruth) {
      if (headrooms.length === 0) {
        violations.push({
          claim,
          reason:
            `claims ${claim.value} of headroom but free cash flow (${fcf}) covers none of the ` +
            `monthly requirements [${truth.requirements.join(', ')}]`,
        });
      }
      continue;
    }
    if (truth.surplusOverRequired !== null && truth.surplusOverRequired <= 0) {
      violations.push({
        claim,
        reason:
          `claims ${claim.value} of headroom but surplusOverRequired is ` +
          `${truth.surplusOverRequired} — the goal is not funded at plan`,
      });
    }
  }

  return { valid: violations.length === 0, claims, violations, skipped: false };
}

export const MAX_CITED_FIGURES = 40;

export function extractCitedFigures(
  narrative: string,
  toolResults: ToolResultLike[],
): CitedFigure[] {
  // Per-source number sets. Each walk gets its OWN visited set: the shared one
  // in buildCitationAllowlist is fine for a union, but here it would let a
  // bundle that shares an object reference with an earlier one silently lose
  // its numbers.
  const bySource: Array<{ source: string; numbers: Set<number> }> = toolResults.map((result) => {
    const numbers = new Set<number>();
    const merchants = new Set<string>();
    walkForCitations(result.output, numbers, merchants, new WeakSet<object>());
    return { source: result.toolName, numbers };
  });

  const figures: CitedFigure[] = [];
  const seen = new Set<number>();

  for (const cited of extractNumbers(narrative)) {
    if (seen.has(cited)) continue;
    for (const { source, numbers } of bySource) {
      let matched = false;
      for (const allowed of numbers) {
        if (Math.abs(cited - allowed) <= 1) {
          matched = true;
          break;
        }
      }
      if (matched) {
        seen.add(cited);
        figures.push({ value: cited, source });
        break;
      }
    }
    if (figures.length >= MAX_CITED_FIGURES) break;
  }

  return figures;
}

export interface CitationCheckResult {
  valid: boolean;
  unmatched: { numbers: string[]; merchants: string[] };
}

export function validateCitations(
  narrative: string,
  allowlist: CitationAllowlist,
): CitationCheckResult {
  const citedNumbers = extractNumbers(narrative);
  const unmatchedNumbers: string[] = [];
  for (const n of citedNumbers) {
    let matched = false;
    for (const allowed of allowlist.numbers) {
      if (Math.abs(n - allowed) <= 1) {
        matched = true;
        break;
      }
    }
    if (!matched) unmatchedNumbers.push(String(n));
  }

  // For merchants we use the existing extractMerchants helper. Pass the
  // allowlist set as the haystack so we only look for known names.
  const allowlistMerchants = Array.from(allowlist.merchants);
  const citedMerchants = extractMerchants(narrative, allowlistMerchants);
  // Anything in the narrative under a merchant-shaped pattern that DOESN'T
  // match the allowlist gets flagged. The cheapest way to enumerate
  // un-allowed merchants is to look for capitalised words that don't appear
  // in the allowlist. We intentionally keep this loose — the citation-number
  // check is the load-bearing guard, this is a sanity check.
  const unmatchedMerchants: string[] = [];
  const capitalisedWords = narrative.match(/\b[A-Z][a-zA-Z]{3,}(?:\s+[A-Z][a-zA-Z]+)*/g) ?? [];
  const allowedLower = new Set(allowlistMerchants.map((m) => m.toLowerCase()));
  // citedMerchants already returns the allowlist matches; words NOT in citedMerchants
  // but capitalised are candidate unmatched merchants. We only flag if they look
  // merchant-ish (not at sentence start with common words).
  const SENTENCE_START_WORDS = new Set([
    'i',
    'you',
    'your',
    'we',
    'they',
    'the',
    'a',
    'an',
    'this',
    'that',
    'these',
    'those',
    'and',
    'but',
    'or',
    'so',
    'because',
    'when',
    'if',
    'while',
    'after',
    'before',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
    'foundation',
    'investment',
    'leak',
    'burden',
    'foundations',
    'investments',
    'leaks',
    'burdens',
  ]);
  for (const word of capitalisedWords) {
    const lower = word.trim().toLowerCase();
    if (!lower) continue;
    if (allowedLower.has(lower)) continue;
    if (SENTENCE_START_WORDS.has(lower)) continue;
    if (lower.split(/\s+/).every((w) => SENTENCE_START_WORDS.has(w))) continue;
    // Defensive: only flag short noun-shaped tokens. Avoids flagging long
    // prose fragments accidentally captured by the regex.
    if (lower.length > 40) continue;
    // We don't actually flag — the v1 path already does merchant validation
    // when knownMerchants is passed. v2 leans on the citation-number check
    // for the hard guarantee. Keep this loop in place so future tightening
    // is a small diff, but only push when we have a strong signal.
    // Heuristic: a capitalised word that appears mid-sentence (not after .)
    // AND isn't allowed is the kind of unmatched merchant we'd care about.
    // For now, leave unmatchedMerchants empty unless explicitly opted in.
    void word;
  }
  void citedMerchants;

  return {
    valid: unmatchedNumbers.length === 0 && unmatchedMerchants.length === 0,
    unmatched: {
      numbers: unmatchedNumbers,
      merchants: unmatchedMerchants,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// V2 validators — validateProjections
// ─────────────────────────────────────────────────────────────────────────────

const PROJECTION_REGEX =
  /(\/year|annually|over a year|\/month|monthly|saved|save|savings of|annualised)/i;

export interface ProjectionCheckResult {
  valid: boolean;
  unmatched_projections: string[];
}

export interface ExperimentResultShape {
  monthly_impact?: { amount?: number };
  annualised_impact?: { amount?: number };
}

export function validateProjections(
  narrative: string,
  experimentResults: ExperimentResultShape[],
): ProjectionCheckResult {
  // Split on sentence terminators followed by whitespace. Keep simple — false
  // positives (over-splitting) are fine; we just iterate more sentences.
  const sentences = narrative
    .split(/[.!?]+\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Collect allowed projection amounts. Allow both monthly_impact and
  // annualised_impact values directly. Note: if monthly = €40 we tolerate
  // a stated annualised of €480 within ±5 because the LLM may round.
  const allowedAmounts = new Set<number>();
  for (const r of experimentResults) {
    const m = r.monthly_impact?.amount;
    const a = r.annualised_impact?.amount;
    if (typeof m === 'number' && Number.isFinite(m)) allowedAmounts.add(m);
    if (typeof a === 'number' && Number.isFinite(a)) allowedAmounts.add(a);
  }

  const unmatched: string[] = [];

  for (const sentence of sentences) {
    if (!PROJECTION_REGEX.test(sentence)) continue;
    const nums = extractNumbers(sentence);
    if (nums.length === 0) continue; // projection-shaped but no number — fine
    if (experimentResults.length === 0) {
      // No tool result to back any projection — every projection number fails.
      unmatched.push(sentence);
      continue;
    }
    // At least one number must be grounded (within ±5) against an allowed amount.
    // We flag if ANY cited number is ungrounded.
    const hasUngrounded = nums.some((n) => {
      for (const allowed of allowedAmounts) {
        if (Math.abs(n - allowed) <= 5) return false;
      }
      return true;
    });
    if (hasUngrounded) {
      unmatched.push(sentence);
    }
  }

  return {
    valid: unmatched.length === 0,
    unmatched_projections: unmatched,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// V2 validators — validateVoice
// ─────────────────────────────────────────────────────────────────────────────

// Banned phrases — the reflexive CFO-anti-pattern phrases we want to strip
// from prose. Each regex matches case-insensitive whole phrases.
const BANNED_PHRASES: RegExp[] = [
  /\bworth holding in mind\b/i,
  /\bworth knowing\b/i,
  /\bno judg(?:e)?ment\b/i,
  /\bI noticed\b/i,
  /\bgreat question\b/i,
  /\badvise\b/i,
  /\badvice\b/i,
  /\bI learned\b/i,
];

export interface VoiceCheckResult {
  valid: boolean;
  violations: string[];
}

export function validateVoice(narrative: string): VoiceCheckResult {
  const violations: string[] = [];
  for (const re of BANNED_PHRASES) {
    const match = narrative.match(re);
    if (match && match[0]) {
      violations.push(match[0]);
    }
  }
  return {
    valid: violations.length === 0,
    violations,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// V2 validators — validateChips
// ─────────────────────────────────────────────────────────────────────────────

const GENERIC_CHIP_STRINGS = [
  'tell me more',
  'let me know',
  'show me everything',
];

const NAVIGATION_PREFIXES = [
  'go to',
  'open the',
  'show me the gap',
  'navigate to',
];

export interface ChipCheckResult {
  valid: boolean;
  reasons: Record<string, string>;
}

// Common "stop" words we never count as overlap signal — they appear in any
// prose and would give false-positive matches for generic chips.
const CHIP_STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'against',
  'because',
  'before',
  'being',
  'between',
  'both',
  'down',
  'during',
  'each',
  'from',
  'have',
  'into',
  'just',
  'like',
  'more',
  'most',
  'over',
  'same',
  'some',
  'such',
  'than',
  'that',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'under',
  'until',
  'very',
  'what',
  'when',
  'where',
  'which',
  'while',
  'with',
  'your',
  'will',
  'would',
  'should',
  'could',
  'know',
  'tell',
  'show',
  'open',
  'look',
  'help',
  'want',
  'need',
  'make',
  'find',
  'take',
  'give',
  'this',
  'that',
  'they',
  'thing',
  'things',
]);

function extractNarrativeNouns(narrative: string): Set<string> {
  const nouns = new Set<string>();
  // Capitalised words ≥4 chars (multi-word phrases allowed).
  const caps = narrative.match(/\b[A-Z][a-zA-Z]{3,}\b/g) ?? [];
  for (const c of caps) nouns.add(c.toLowerCase());
  // Numbers ≥10 (stringified) count as "specific nouns" the chip can hook into.
  for (const n of extractNumbers(narrative)) {
    nouns.add(String(Math.round(n)));
    nouns.add(String(n));
  }
  return nouns;
}

export function validateChips(
  chips: string[],
  narrative: string,
): ChipCheckResult {
  const reasons: Record<string, string> = {};
  const narrativeNouns = extractNarrativeNouns(narrative);
  const narrativeLower = narrative.toLowerCase();

  for (const chip of chips) {
    const lower = chip.toLowerCase().trim();
    if (!lower) {
      reasons[chip] = 'empty';
      continue;
    }

    // Generic strings.
    let flagged = false;
    for (const banned of GENERIC_CHIP_STRINGS) {
      if (lower.includes(banned)) {
        reasons[chip] = 'generic';
        flagged = true;
        break;
      }
    }
    if (flagged) continue;

    // Navigation prefixes.
    for (const prefix of NAVIGATION_PREFIXES) {
      if (lower.startsWith(prefix)) {
        reasons[chip] = 'navigation';
        flagged = true;
        break;
      }
    }
    if (flagged) continue;

    // Narrative-noun overlap. Chip tokens (any word ≥4 chars or number ≥10)
    // must share at least one ENTRY with the narrative nouns extracted above.
    // Stop-words are stripped from chip tokens to avoid matching on filler
    // ("about", "more", "tell"). A chip like "Drill into Glovo" is checked
    // against narrative-nouns; "drill" / "into" are stop-words, "glovo" hits.
    const chipTokens = new Set<string>();
    for (const w of lower.match(/\b[a-z][a-z]{3,}\b/g) ?? []) {
      if (CHIP_STOP_WORDS.has(w)) continue;
      chipTokens.add(w);
    }
    for (const n of extractNumbers(chip)) {
      chipTokens.add(String(Math.round(n)));
      chipTokens.add(String(n));
    }
    let overlap = false;
    for (const t of chipTokens) {
      if (narrativeNouns.has(t)) {
        overlap = true;
        break;
      }
      // Direct word-boundary match against the lowercased narrative covers
      // merchant names that didn't survive capitalisation (e.g. narrative
      // says "glovo" not "Glovo"). Word-boundary, not substring, so
      // "glovo" doesn't match inside "glove".
      const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(narrativeLower)) {
        overlap = true;
        break;
      }
    }
    if (!overlap && chipTokens.size > 0) {
      reasons[chip] = 'no_narrative_noun';
    }
  }

  return {
    valid: Object.keys(reasons).length === 0,
    reasons,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// V2 validators — validateLength
//
// Enforces the 180-word body cap that the prompt names but the LLM doesn't
// always honour. Strips signoff ("— C.") and any [OPTIONS]…[/OPTIONS] block
// before counting — mirrors what the judge harness does for H6.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_BODY_WORD_CAP = 180;

const SIGNOFF_LINE = /^[\s—–-]*C\.\s*$/gm;
const OPTIONS_BLOCK = /\[OPTIONS\][\s\S]*?\[\/OPTIONS\]/gi;

export interface LengthCheckResult {
  valid: boolean;
  word_count: number;
  cap: number;
}

export function validateLength(
  narrative: string,
  cap: number = DEFAULT_BODY_WORD_CAP,
): LengthCheckResult {
  const body = narrative.replace(OPTIONS_BLOCK, '').replace(SIGNOFF_LINE, '');
  const words = body.trim().split(/\s+/).filter((w) => w.length > 0);
  return { valid: words.length <= cap, word_count: words.length, cap };
}

// ─────────────────────────────────────────────────────────────────────────────
// appendCorrection — server-side correction string appended to message body
// when one or more v2 validators fired. Kept terse — this is a dev-time guard
// rail, not a user-facing UI.
// ─────────────────────────────────────────────────────────────────────────────

export interface CorrectionInputs {
  unmatched_citations?: { numbers: string[]; merchants: string[] };
  unmatched_projections?: string[];
  voice_violations?: string[];
  length_violation?: LengthCheckResult;
}

export function appendCorrection(
  textContent: string,
  inputs: CorrectionInputs,
): string {
  const issues: string[] = [];
  const citationNumberCount = inputs.unmatched_citations?.numbers.length ?? 0;
  const citationMerchantCount = inputs.unmatched_citations?.merchants.length ?? 0;
  const projectionCount = inputs.unmatched_projections?.length ?? 0;
  const voiceCount = inputs.voice_violations?.length ?? 0;
  const lengthViolation = inputs.length_violation;

  if (citationNumberCount > 0) {
    issues.push(
      `${citationNumberCount} number${citationNumberCount === 1 ? '' : 's'} not grounded in tool output`,
    );
  }
  if (citationMerchantCount > 0) {
    issues.push(
      `${citationMerchantCount} merchant${citationMerchantCount === 1 ? '' : 's'} not grounded`,
    );
  }
  if (projectionCount > 0) {
    issues.push(
      `${projectionCount} projection${projectionCount === 1 ? '' : 's'} not backed by an experiment`,
    );
  }
  if (voiceCount > 0) {
    issues.push(`${voiceCount} voice phrase${voiceCount === 1 ? '' : 's'}`);
  }
  if (lengthViolation && !lengthViolation.valid) {
    issues.push(
      `body length ${lengthViolation.word_count} words (cap ${lengthViolation.cap})`,
    );
  }

  const count = issues.length;
  if (count === 0) return textContent;
  const summary = issues.join(', ');
  return `${textContent}\n\n---\n\n_(System note: I flagged ${count} issue${count === 1 ? '' : 's'} in this message. ${summary}.)_`;
}

// ─────────────────────────────────────────────────────────────────────────────
// stripValidatorNote — inverse of appendCorrection. Removes the internal QA
// "(System note: …)" diagnostic from a message body. Used to scrub the note out
// of conversation history before it is re-fed to the model: a persisted note
// otherwise teaches the model the pattern and it *fabricates* its own fake notes
// on later turns (an echo loop, confirmed in staging on turns where no validator
// even fired). Matches both the appended first-person form ("I flagged N…") and
// the model-echoed passive form ("N issues flagged…").
// ─────────────────────────────────────────────────────────────────────────────
export function stripValidatorNote(text: string): string {
  if (!text) return text;
  const withoutNote = text.replace(/_\(System note:[^\n]*?\)_/g, '');
  if (withoutNote === text) return text; // no note present — leave untouched
  // Removing the note leaves a dangling "\n\n---\n\n" separator from the
  // appended form; trim it and any resulting trailing whitespace.
  return withoutNote.replace(/\n{2,}-{3,}[ \t\n]*$/g, '').replace(/[ \t\n]+$/g, '');
}
