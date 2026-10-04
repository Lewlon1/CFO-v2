import { describe, it, expect } from 'vitest';
import { computeRealisedScore } from '../realised-score';
import type { WowEvent, WowEventType } from '../event-types';

function ev(event_type: WowEventType, idx = 0): WowEvent {
  return {
    id: `evt-${event_type}-${idx}`,
    user_id: 'user-1',
    first_read_message_id: 'msg-1',
    conversation_id: 'conv-1',
    event_type,
    metadata: {},
    created_at: new Date(2026, 4, 26, 10, idx).toISOString(),
  };
}

describe('computeRealisedScore', () => {
  it('returns 0.0 when no events present', () => {
    const r = computeRealisedScore([]);
    expect(r.realised_wow_score).toBe(0);
    expect(r.in_session_score).toBe(0);
    expect(r.overnight_score).toBe(0);
    expect(r.reasoning).toEqual({
      replied_substantively: false,
      chip_tapped: false,
      scrolled_to_bottom: false,
      returned_d2: false,
      resonance_tap: null,
      error_report_tapped: false,
    });
  });

  it('delivered alone scores 0 (it is the precondition, not a signal)', () => {
    const r = computeRealisedScore([ev('delivered')]);
    expect(r.realised_wow_score).toBe(0);
  });

  it('scrolled_to_bottom alone scores 0.105 (0.7 × 0.15)', () => {
    const r = computeRealisedScore([ev('scrolled_to_bottom')]);
    expect(r.in_session_score).toBe(0.15);
    expect(r.overnight_score).toBe(0);
    expect(r.realised_wow_score).toBe(0.105);
    expect(r.reasoning.scrolled_to_bottom).toBe(true);
  });

  it('chip_tapped alone scores 0.28 (0.7 × 0.4)', () => {
    const r = computeRealisedScore([ev('chip_tapped')]);
    expect(r.in_session_score).toBe(0.4);
    expect(r.realised_wow_score).toBe(0.28);
    expect(r.reasoning.chip_tapped).toBe(true);
  });

  // Session 083 — error_report_tapped shares chip_tapped's 0.4 tier. Someone who
  // spots a wrong number read the thing closely; the tier is about attention,
  // not about whether they liked what they read.
  it('error_report_tapped alone scores 0.28, same tier as chip_tapped', () => {
    const r = computeRealisedScore([ev('error_report_tapped')]);
    expect(r.in_session_score).toBe(0.4);
    expect(r.realised_wow_score).toBe(0.28);
    expect(r.reasoning.error_report_tapped).toBe(true);
  });

  it('error_report_tapped outranks scrolled_to_bottom', () => {
    const r = computeRealisedScore([ev('scrolled_to_bottom'), ev('error_report_tapped')]);
    expect(r.in_session_score).toBe(0.4);
    expect(r.reasoning.scrolled_to_bottom).toBe(true);
    expect(r.reasoning.error_report_tapped).toBe(true);
  });

  it('does not stack with chip_tapped — the tiers are a max, not a sum', () => {
    const r = computeRealisedScore([ev('chip_tapped'), ev('error_report_tapped')]);
    expect(r.in_session_score).toBe(0.4);
  });

  it('replied_substantively still wins over error_report_tapped', () => {
    const r = computeRealisedScore([ev('error_report_tapped'), ev('replied_substantively')]);
    expect(r.in_session_score).toBe(1.0);
    expect(r.realised_wow_score).toBe(0.7);
    expect(r.reasoning.error_report_tapped).toBe(true);
  });

  it('replied_substantively alone scores 0.7 (0.7 × 1.0)', () => {
    const r = computeRealisedScore([ev('replied_substantively')]);
    expect(r.in_session_score).toBe(1);
    expect(r.realised_wow_score).toBe(0.7);
    expect(r.reasoning.replied_substantively).toBe(true);
  });

  it('returned_d2 alone scores 0.3 (0.3 × 1.0)', () => {
    const r = computeRealisedScore([ev('returned_d2')]);
    expect(r.in_session_score).toBe(0);
    expect(r.overnight_score).toBe(1);
    expect(r.realised_wow_score).toBe(0.3);
    expect(r.reasoning.returned_d2).toBe(true);
  });

  it('replied + returned_d2 maxes out at 1.0', () => {
    const r = computeRealisedScore([
      ev('replied_substantively'),
      ev('returned_d2', 1),
    ]);
    expect(r.realised_wow_score).toBe(1);
  });

  it('chip_tapped + returned_d2 scores 0.58 (0.7 × 0.4 + 0.3 × 1.0)', () => {
    const r = computeRealisedScore([ev('chip_tapped'), ev('returned_d2', 1)]);
    expect(r.realised_wow_score).toBe(0.58);
  });

  it('scrolled + chipped uses max() (0.28), not sum', () => {
    const r = computeRealisedScore([ev('scrolled_to_bottom'), ev('chip_tapped', 1)]);
    expect(r.in_session_score).toBe(0.4);
    expect(r.realised_wow_score).toBe(0.28);
  });

  it('replied + scrolled + chipped still uses max() (1.0 → 0.7)', () => {
    const r = computeRealisedScore([
      ev('scrolled_to_bottom'),
      ev('chip_tapped', 1),
      ev('replied_substantively', 2),
    ]);
    expect(r.in_session_score).toBe(1);
    expect(r.realised_wow_score).toBe(0.7);
  });

  it('resonance_tap_positive alone does NOT factor into the score', () => {
    const r = computeRealisedScore([ev('resonance_tap_positive')]);
    expect(r.realised_wow_score).toBe(0);
    expect(r.reasoning.resonance_tap).toBe('positive');
  });

  it('resonance_tap_negative reported but excluded from score', () => {
    const r = computeRealisedScore([ev('chip_tapped'), ev('resonance_tap_negative', 1)]);
    expect(r.realised_wow_score).toBe(0.28);
    expect(r.reasoning.resonance_tap).toBe('negative');
  });

  it('positive tap wins over negative when both present (positive is checked first)', () => {
    const r = computeRealisedScore([
      ev('resonance_tap_positive'),
      ev('resonance_tap_negative', 1),
    ]);
    expect(r.reasoning.resonance_tap).toBe('positive');
  });

  it('duplicate event types do not change the score (set semantics)', () => {
    const r = computeRealisedScore([
      ev('chip_tapped'),
      ev('chip_tapped', 1),
      ev('chip_tapped', 2),
    ]);
    expect(r.realised_wow_score).toBe(0.28);
    expect(r.reasoning.chip_tapped).toBe(true);
  });

  it('full house: replied + chipped + scrolled + returned + positive tap = 1.0', () => {
    const r = computeRealisedScore([
      ev('delivered'),
      ev('scrolled_to_bottom', 1),
      ev('chip_tapped', 2),
      ev('replied_substantively', 3),
      ev('returned_d2', 4),
      ev('resonance_tap_positive', 5),
    ]);
    expect(r.realised_wow_score).toBe(1);
    expect(r.in_session_score).toBe(1);
    expect(r.overnight_score).toBe(1);
    expect(r.reasoning).toEqual({
      replied_substantively: true,
      chip_tapped: true,
      scrolled_to_bottom: true,
      returned_d2: true,
      resonance_tap: 'positive',
      error_report_tapped: false,
    });
  });
});
