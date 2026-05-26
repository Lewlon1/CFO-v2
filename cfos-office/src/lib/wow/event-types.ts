// Session 32 (C) — Wow event type definitions shared between client tracker,
// API route, cron aggregator, and admin dashboard.

export const WOW_EVENT_TYPES = [
  'delivered',
  'scrolled_to_bottom',
  'chip_tapped',
  'replied_substantively',
  'resonance_tap_positive',
  'resonance_tap_negative',
  'returned_d2',
] as const;

export type WowEventType = (typeof WOW_EVENT_TYPES)[number];

export type WowEvent = {
  id: string;
  user_id: string;
  first_insight_message_id: string;
  conversation_id: string;
  event_type: WowEventType;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type RealisedScoreResult = {
  realised_wow_score: number;
  in_session_score: number;
  overnight_score: number;
  reasoning: {
    replied_substantively: boolean;
    chip_tapped: boolean;
    scrolled_to_bottom: boolean;
    returned_d2: boolean;
    resonance_tap: 'positive' | 'negative' | null;
  };
};
