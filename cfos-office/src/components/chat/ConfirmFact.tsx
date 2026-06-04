'use client';

// Fact-confirmation tap. The CFO emits [CONFIRM_FACT]statement[/CONFIRM_FACT]
// when it wants the user to confirm a single binary fact about a specific
// transaction (e.g. "The Hacienda PR payment is a tax debt"). The user answers
// Yes / Not quite; the answer is sent back into chat verbatim so the CFO can
// record and act on it. When the same message also carries option chips, those
// are held back until the fact is answered (confirm first, then reveal).

import { useState } from 'react';
import { TappableOptions } from './TappableOptions';

type Props = {
  fact: string;
  /** Option chips to reveal once the fact is answered (may be null). */
  options: string[] | null;
  /** Sends the given text back into chat as the user's next message. */
  onSelect?: (text: string) => void;
};

export function ConfirmFact({ fact, options, onSelect }: Props) {
  const [answered, setAnswered] = useState(false);

  function answer(confirmed: boolean) {
    if (answered) return;
    setAnswered(true);
    const reply = confirmed ? `Yes — ${fact}` : `Not quite — ${fact}`;
    onSelect?.(reply);
  }

  return (
    <div className="mt-3 px-3">
      <div className="rounded-card border border-border bg-input/40 px-4 py-3">
        <p className="text-sm text-foreground/90 mb-2.5">{fact}</p>
        {answered ? (
          <p className="text-xs text-muted-foreground italic">Noted — thanks.</p>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => answer(true)}
              className="px-4 py-2 text-sm rounded-control border border-border bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity min-h-11"
            >
              Yes, that&apos;s right
            </button>
            <button
              type="button"
              onClick={() => answer(false)}
              className="px-4 py-2 text-sm rounded-control border border-border text-foreground/80 hover:bg-muted transition-colors min-h-11"
            >
              Not quite
            </button>
          </div>
        )}
      </div>

      {/* Reveal the other choices only after the fact is answered. */}
      {answered && options && onSelect && (
        <TappableOptions options={options} onSelect={onSelect} />
      )}
    </div>
  );
}
