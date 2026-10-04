'use client';

// Session 083 — the one affordance under the First Read.
//
// It replaced two ratings that sat here before it (MessageFeedback's thumbs,
// suppressed on this message in MessageList; ResonanceTap's yes/no, deleted).
// Both produced a number nobody could act on. This produces a diff: the user
// names the figure that is wrong, and the route stores it alongside the prose
// they were reading and the computed figures that Read cited.
//
// Two deliberate constraints:
//  - Not a turn. C. never asks. This is a quiet inline control, not a question
//    in the conversation — a CFO who asks "was that right?" reads as unsure.
//  - The TAP is the signal. error_report_tapped fires the moment the field
//    opens, before a single character is typed, so a user who opens it and
//    thinks better of it still counts as engaged. The submitted text is a
//    separate thing entirely, and lives in read_feedback.

import { useEffect, useRef, useState } from 'react';

import { Textarea } from '@/components/ui/Input';
import { focusRing } from '@/components/ui/focus';
import { cn } from '@/lib/utils';
import { trackWowEvent } from '@/lib/wow/event-tracker';
import { MAX_REPORT_LENGTH, buildReportPayload, isSendableReport } from '@/lib/reads/feedback-contract';

type Props = {
  first_read_message_id: string;
  conversation_id: string;
};

export function ReadErrorReport({ first_read_message_id, conversation_id }: Props) {
  const [phase, setPhase] = useState<'idle' | 'open' | 'sent'>('idle');
  const [draft, setDraft] = useState('');
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (phase === 'open') fieldRef.current?.focus();
  }, [phase]);

  function open() {
    // Fires once per mount; trackWowEvent's inflight guard absorbs a remount.
    // Deliberately not awaited and deliberately before the field opens — the
    // engagement signal is the tap, not the submission.
    void trackWowEvent({
      event_type: 'error_report_tapped',
      first_read_message_id,
      conversation_id,
    });
    setPhase('open');
  }

  function send() {
    if (!isSendableReport(draft)) return;
    setPhase('sent');
    // Fire-and-forget, as MessageFeedback does: never block the UI on this, and
    // never make the user watch a spinner to tell us our own number was wrong.
    fetch('/api/reads/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildReportPayload(first_read_message_id, conversation_id, draft)),
    }).catch(() => {});
  }

  if (phase === 'sent') {
    return (
      <div className="mt-3 text-xs text-muted-foreground italic">
        Logged. I&apos;ll check that against the source.
      </div>
    );
  }

  if (phase === 'open') {
    return (
      <div className="mt-4 pt-3 border-t border-border/60">
        <Textarea
          ref={fieldRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_REPORT_LENGTH}
          rows={3}
          placeholder="Which figure is wrong, and what it should be."
          aria-label="What in this read is wrong"
          className="text-sm"
        />
        <div className="flex items-center gap-3 mt-2">
          <button
            type="button"
            onClick={send}
            disabled={!isSendableReport(draft)}
            className={cn(
              'px-3 py-1.5 text-xs rounded-md border border-border transition-colors min-h-[44px]',
              'hover:border-primary/60 hover:bg-primary/5 text-foreground/80',
              'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:bg-transparent',
              focusRing,
            )}
          >
            Send
          </button>
          <button
            type="button"
            onClick={() => setPhase('idle')}
            className={cn(
              'text-xs text-muted-foreground hover:text-foreground transition-colors min-h-[44px] px-1',
              focusRing,
            )}
          >
            Never mind
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-3 border-t border-border/60">
      <button
        type="button"
        onClick={open}
        className={cn(
          'text-xs text-muted-foreground hover:text-foreground transition-colors min-h-[44px] px-1',
          focusRing,
        )}
      >
        Anything in here wrong?
      </button>
    </div>
  );
}
