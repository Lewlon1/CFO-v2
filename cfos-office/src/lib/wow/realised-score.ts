// Session 32 (C) — Compute realised_wow_score from a set of wow_events for a
// single first_read. Pure functions; the single source of truth for the
// scoring formula.
//
// Formula:
//   in_session = max(
//     1.0  if replied_substantively,
//     0.4  if chip_tapped,
//     0.15 if scrolled_to_bottom
//   )
//   overnight = 1.0 if returned_d2 else 0.0
//   realised_wow = 0.7 × in_session + 0.3 × overnight
//
// ResonanceTap is reported alongside but does NOT factor into the score — it
// is an explicit signal, not behavioural. See docs/audits/2026-05-26-session-32C.md.

import type { WowEvent, RealisedScoreResult, WowEventType } from './event-types';

export function computeRealisedScore(events: ReadonlyArray<WowEvent>): RealisedScoreResult {
  const has = (type: WowEventType) => events.some((e) => e.event_type === type);

  const replied = has('replied_substantively');
  const chipped = has('chip_tapped');
  const scrolled = has('scrolled_to_bottom');
  const returned = has('returned_d2');

  const inSession = replied ? 1.0 : chipped ? 0.4 : scrolled ? 0.15 : 0.0;
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
    },
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
