'use client';

// Session 32 (C) — Explicit "did this read you right?" tap on the first Read.
// Renders only on the first assistant message of a layered first_insight
// conversation. Captured separately from realised_wow_score (see
// docs/audits/2026-05-26-session-32C.md): this is an explicit signal, not
// behavioural.

import { useState } from 'react';
import { trackWowEvent } from '@/lib/wow/event-tracker';

type Props = {
  first_insight_message_id: string;
  conversation_id: string;
};

export function ResonanceTap({ first_insight_message_id, conversation_id }: Props) {
  const [tapped, setTapped] = useState<'positive' | 'negative' | null>(null);

  function tap(kind: 'positive' | 'negative') {
    if (tapped) return;
    setTapped(kind);
    void trackWowEvent({
      event_type:
        kind === 'positive' ? 'resonance_tap_positive' : 'resonance_tap_negative',
      first_insight_message_id,
      conversation_id,
    });
  }

  if (tapped) {
    return (
      <div className="mt-3 text-xs text-muted-foreground italic">
        {tapped === 'positive'
          ? "Thanks. I'll keep going in this direction."
          : "Got it. I'll adjust."}
      </div>
    );
  }

  return (
    <div className="mt-4 pt-3 border-t border-border/60">
      <div className="text-xs text-muted-foreground mb-2">Did this read you right?</div>
      <div className="flex gap-2">
        <button
          onClick={() => tap('positive')}
          className="px-3 py-1.5 text-xs rounded-md border border-border hover:border-primary/60 hover:bg-primary/5 text-foreground/80 transition-colors min-h-[44px]"
          aria-label="Yes, this read me right"
        >
          Yes
        </button>
        <button
          onClick={() => tap('negative')}
          className="px-3 py-1.5 text-xs rounded-md border border-border hover:border-destructive/60 hover:bg-destructive/5 text-foreground/80 transition-colors min-h-[44px]"
          aria-label="Not really"
        >
          Not really
        </button>
      </div>
    </div>
  );
}
