// Session 32 (C) — Client-side wow event tracker.
// Fire-and-forget POSTs to /api/wow/event. Per-event-type idempotency lives
// on the server via a partial unique index; the in-memory guard here just
// prevents wasted round-trips when a component re-mounts within the same
// session.

import type { WowEventType } from './event-types';

const inflight = new Set<string>();

export type TrackParams = {
  event_type: WowEventType;
  first_read_message_id: string;
  conversation_id: string;
  metadata?: Record<string, unknown>;
};

export async function trackWowEvent(params: TrackParams): Promise<void> {
  const key = `${params.first_read_message_id}:${params.event_type}`;
  if (inflight.has(key)) return;
  inflight.add(key);

  try {
    await fetch('/api/wow/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch (err) {
    // Telemetry must never block UX. Log and move on.
    console.warn('[wow] event tracking failed', err);
  }
}

// Substantive reply detector. Called from the chat input's send handler when
// there is an active first-Read context in the recent (5-minute) window.
export function detectSubstantiveReply(
  replyText: string,
  context: {
    first_read_message_id: string;
    first_read_delivered_at: number; // epoch ms
    conversation_id: string;
  },
): void {
  if (replyText.trim().length < 10) return;
  const minutesSince = (Date.now() - context.first_read_delivered_at) / 60_000;
  if (minutesSince > 5) return;

  void trackWowEvent({
    event_type: 'replied_substantively',
    first_read_message_id: context.first_read_message_id,
    conversation_id: context.conversation_id,
    metadata: {
      reply_length: replyText.length,
      minutes_since_delivery: Number(minutesSince.toFixed(2)),
    },
  });
}
