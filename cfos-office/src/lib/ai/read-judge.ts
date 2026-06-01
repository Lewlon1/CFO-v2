// ─────────────────────────────────────────────────────────────────────────────
// Read judge — the single source of truth for what a *current* first Read must
// look like. Calibrated to the live composition contract in
// `src/lib/ai/prompts/first-read.ts` (NOT the retired first-insight format that
// `judge-first-insight.ts` historically encoded — 100–180 words, [OPTIONS]
// chips, "ends with a question" as a pass).
//
// Current Read contract (see FIRST_READ_SYSTEM_PROMPT*):
//   - signs off "— C." on its own line
//   - hard cap 250 words (body, excluding the signoff + the CTA markup)
//   - closes on exactly ONE [CTA:type]label[/CTA] line (value-first → the type
//     is start_value_map_real); NEVER an [OPTIONS] chip block
//   - never ends on a question back to the user
//   - no emoji, no banned reflexive-CFO phrases (mirrors prod `validateVoice`)
//   - cites at least one real merchant / cluster from the user's data
//
// Two consumers share these rules:
//   1. the persona test harness (tests/onboarding/runner/judge.ts) — asserts the
//      hard rules on captured Read output;
//   2. the nightly wow-aggregate cron — derives a deterministic predicted_wow
//      score from the same rules + composition richness (no LLM in the batch job,
//      so it stays fast and reproducible).
// ─────────────────────────────────────────────────────────────────────────────

import { validateVoice } from '@/lib/ai/insight-validator';

/** Word cap from the live composition prompt (was 180 in the retired format). */
export const READ_WORD_CAP = 250;

/** Stable id stamped on wow_assessments.judge_id so predicted scores are traceable. */
export const READ_JUDGE_ID = 'read-heuristic-v1';

export interface ReadHardRule {
  ruleId: string;
  passed: boolean;
  detail?: string;
}

export interface ReadJudgeOptions {
  /** Composition mode — value_first enforces the start_value_map_real CTA. */
  mode?: 'default' | 'value_first';
  /** Lowercased merchant / cluster names from the user's data. When provided, the Read must cite at least one. */
  knownMerchants?: string[];
  /** Override the word cap (defaults to READ_WORD_CAP). */
  wordCap?: number;
}

// One [CTA:type]label[/CTA] block. Type is a lowercase snake identifier.
const CTA_RE = /\[CTA:([a-z_]+)\]([\s\S]*?)\[\/CTA\]/gi;
// The retired chip block — its presence is itself a failure now.
const OPTIONS_RE = /\[OPTIONS\][\s\S]*?\[\/OPTIONS\]/i;
// "— C." (em dash, en dash or hyphen) alone on the final line.
const SIGNOFF_RE = /(?:^|\n)\s*[—–-]\s*C\.\s*$/;
// Pictographic ranges + variation selectors. Deliberately excludes currency/maths.
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

/** Strip the signoff line and any CTA markup so word counting / close detection see prose only. */
function readBody(text: string): string {
  return text
    .replace(CTA_RE, '')
    .replace(SIGNOFF_RE, '')
    .trim();
}

/**
 * Deterministic hard-rule checks for a current first Read. Returns one result
 * per rule; callers decide how to weight / gate on them.
 */
export function checkReadHardRules(text: string, opts: ReadJudgeOptions = {}): ReadHardRule[] {
  const mode = opts.mode ?? 'default';
  const cap = opts.wordCap ?? READ_WORD_CAP;
  const rules: ReadHardRule[] = [];

  // H1 — signoff present.
  rules.push({
    ruleId: 'H1_signoff_present',
    passed: SIGNOFF_RE.test(text.trimEnd()),
    detail: 'expected "— C." on its own final line',
  });

  // H2 — body within the word cap.
  const words = readBody(text).split(/\s+/).filter(Boolean);
  rules.push({
    ruleId: 'H2_within_word_cap',
    passed: words.length <= cap,
    detail: `${words.length}/${cap} words`,
  });

  // H3 — exactly one CTA line.
  const ctas = [...text.matchAll(CTA_RE)];
  rules.push({
    ruleId: 'H3_exactly_one_cta',
    passed: ctas.length === 1,
    detail: `${ctas.length} [CTA] block(s)`,
  });

  // H3b — value-first Reads must close on the Value Map CTA.
  if (mode === 'value_first') {
    const ctaType = ctas[0]?.[1] ?? '(none)';
    rules.push({
      ruleId: 'H3b_value_first_cta_type',
      passed: ctas.length === 1 && ctaType === 'start_value_map_real',
      detail: `CTA type: ${ctaType}`,
    });
  }

  // H4 — no retired [OPTIONS] chip block.
  rules.push({
    ruleId: 'H4_no_options_block',
    passed: !OPTIONS_RE.test(text),
    detail: 'retired [OPTIONS] chip format must not appear',
  });

  // H5 — the close is not a question back to the user.
  const body = readBody(text);
  const lastSentence = body.split(/(?<=[.!?])\s+/).filter(Boolean).pop() ?? '';
  rules.push({
    ruleId: 'H5_no_question_close',
    passed: !lastSentence.trimEnd().endsWith('?'),
    detail: lastSentence.slice(-60),
  });

  // H6 — no emoji.
  rules.push({
    ruleId: 'H6_no_emoji',
    passed: !EMOJI_RE.test(text),
  });

  // H7 — no banned reflexive-CFO phrases (single source of truth: prod validator).
  const voice = validateVoice(text);
  rules.push({
    ruleId: 'H7_voice_no_banned',
    passed: voice.valid,
    detail: voice.violations.join(', '),
  });

  // H8 — cites at least one real merchant / cluster (only when we know the universe).
  if (opts.knownMerchants && opts.knownMerchants.length > 0) {
    const lower = text.toLowerCase();
    const hit = opts.knownMerchants.some((m) => m && lower.includes(m.toLowerCase()));
    rules.push({
      ruleId: 'H8_cites_known_merchant',
      passed: hit,
      detail: hit ? undefined : 'no known merchant/cluster cited',
    });
  }

  return rules;
}

export interface ReadMetadataSignals {
  /** layers_used from FirstReadMetadata, e.g. ['L1','L2','L3','L5']. */
  layersUsed?: string[];
  /** features_cited, e.g. ['trend','recurrence']. */
  featuresCited?: string[];
  /** Whether a stated-intent-vs-behaviour gap was named. */
  gapPresent?: boolean;
  /** clusters_referenced merchant keys. */
  clustersReferenced?: string[];
  /** Composition mode. */
  mode?: 'default' | 'value_first';
}

export interface PredictedWow {
  /** 0–1, rounded to 3dp for NUMERIC(4,3). */
  score: number;
  judgeId: string;
  hardRules: ReadHardRule[];
}

/**
 * Deterministic predicted-wow score for the wow-aggregate cron. Combines format/
 * voice compliance (the hard rules, minus the merchant check which needs the
 * user's merchant universe) with composition richness snapshotted on the
 * conversation. No LLM call — the batch job stays fast and reproducible, and the
 * score is fully explainable from the breakdown.
 *
 * Weighting: 60% format/voice compliance, 40% richness
 * (features 0.4 · gap 0.3 · clusters 0.2 · goal-layer 0.1).
 */
export function predictWowScore(text: string, signals: ReadMetadataSignals = {}): PredictedWow {
  const hardRules = checkReadHardRules(text, { mode: signals.mode });

  // Format/voice compliance: fraction of deterministic rules passed. (H8 is
  // never present here — no merchant universe is passed — so this is purely
  // format + voice.)
  const total = hardRules.length;
  const passed = hardRules.filter((r) => r.passed).length;
  const formatScore = total > 0 ? passed / total : 0;

  // Richness from the composition snapshot.
  const featureScore = Math.min(signals.featuresCited?.length ?? 0, 3) / 3;
  const clusterScore = Math.min(signals.clustersReferenced?.length ?? 0, 2) / 2;
  const gapScore = signals.gapPresent ? 1 : 0;
  const goalScore = (signals.layersUsed ?? []).includes('L5') ? 1 : 0;
  const richness = 0.4 * featureScore + 0.3 * gapScore + 0.2 * clusterScore + 0.1 * goalScore;

  const raw = 0.6 * formatScore + 0.4 * richness;
  const score = Math.round(Math.max(0, Math.min(1, raw)) * 1000) / 1000;

  return { score, judgeId: READ_JUDGE_ID, hardRules };
}
