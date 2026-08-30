// Session 32 (C) — Compute realised_wow_score from a set of wow_events for a
// single first_read. Pure functions; the single source of truth for the
// scoring formula.
//
// Formula:
//   in_session = max(
//     1.0  if replied_substantively,
//     0.4  if chip_tapped OR error_report_tapped,
//     0.15 if scrolled_to_bottom
//   )
//   overnight = 1.0 if returned_d2 else 0.0
//   realised_wow = 0.7 × in_session + 0.3 × overnight
//
// resonance_tap_* is reported alongside but does NOT factor into the score — it
// was an explicit signal, not behavioural. See docs/audits/2026-05-26-session-32C.md.
// The control that produced it (ResonanceTap) was removed in Session 083; the
// events, the reasoning field and the admin columns stay so pre-083 rows still
// read correctly.
//
// error_report_tapped joined the 0.4 tier in Session 083. Someone who spots a
// wrong number read the thing closely; that is engagement, and this formula has
// always been valence-free (a chip tap counts whether or not the user liked what
// they read). It is deliberately the TAP, not the submitted report — the tier is
// about attention, not about how bad the error was.
//
// Because the tiers combine with max(), this change can only ever RAISE a score,
// never lower one. Scores computed before 083 are therefore a floor, not a like-
// for-like comparison: a pre-083 Read that would have earned 0.4 from an error
// report scored 0.15 or 0.

import type { WowEvent, RealisedScoreResult, WowEventType } from './event-types';

export function computeRealisedScore(events: ReadonlyArray<WowEvent>): RealisedScoreResult {
  const has = (type: WowEventType) => events.some((e) => e.event_type === type);

  const replied = has('replied_substantively');
  const chipped = has('chip_tapped');
  const scrolled = has('scrolled_to_bottom');
  const returned = has('returned_d2');
  const errorReported = has('error_report_tapped');

  const inSession = replied ? 1.0 : chipped || errorReported ? 0.4 : scrolled ? 0.15 : 0.0;
  const overnight = returned ? 1.0 : 0.0;
  const realised = 0.7 * inSession + 0.3 * overnight;

  const positiveTap = has('resonance_tap_positive');
  const negativeTap = has('resonance_tap_negative');

  return {
    realised_wow_score: round3(realised),
    in_session_score: round3(inSession),
    overnight_score: round3(overnight),
    reasoning: {
      replied_substantively: replied,
      chip_tapped: chipped,
      scrolled_to_bottom: scrolled,
      returned_d2: returned,
      resonance_tap: positiveTap ? 'positive' : negativeTap ? 'negative' : null,
      error_report_tapped: errorReported,
    },
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
