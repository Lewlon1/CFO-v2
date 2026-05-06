'use client';

import { useState } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';

interface MessageFeedbackProps {
  messageId: string;
}

export function MessageFeedback({ messageId }: MessageFeedbackProps) {
  const [rating, setRating] = useState<-1 | 1 | null>(null);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function handleRating(value: -1 | 1) {
    const newRating = rating === value ? null : value;
    setRating(newRating);

    if (newRating === null) return;

    if (newRating === -1) {
      setShowComment(true);
    } else {
      setShowComment(false);
      submitFeedback(newRating, null);
    }
  }

  function submitFeedback(r: -1 | 1, c: string | null) {
    setSubmitted(true);
    // Fire-and-forget: feedback POST is best-effort analytics — never block
    // the UI on failure, and a lost rating is acceptable.
    fetch('/api/analytics/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: messageId, rating: r, comment: c }),
    }).catch(() => {});
  }

  return (
    <div className="flex items-center gap-1 mt-1">
      <button
        onClick={() => handleRating(1)}
        className={`p-1 rounded hover:bg-muted transition-colors ${
          rating === 1
            ? 'text-green-600'
            : 'text-muted-foreground/40 hover:text-muted-foreground'
        }`}
        title="Helpful"
        aria-label="Thumbs up"
      >
        <ThumbsUp className="h-3.5 w-3.5" fill={rating === 1 ? 'currentColor' : 'none'} />
      </button>
      <button
        onClick={() => handleRating(-1)}
        className={`p-1 rounded hover:bg-muted transition-colors ${
          rating === -1
            ? 'text-red-500'
            : 'text-muted-foreground/40 hover:text-muted-foreground'
        }`}
        title="Not helpful"
        aria-label="Thumbs down"
      >
        <ThumbsDown className="h-3.5 w-3.5" fill={rating === -1 ? 'currentColor' : 'none'} />
      </button>

      {showComment && !submitted && (
        <div className="flex items-center gap-1 ml-2">
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What went wrong?"
            className="text-xs border rounded px-2 py-1 w-48 bg-background"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && rating !== null) {
                submitFeedback(rating, comment || null);
              }
            }}
          />
          <button
            onClick={() => rating !== null && submitFeedback(rating, comment || null)}
            className="text-xs text-primary hover:underline"
          >
            Send
          </button>
        </div>
      )}

      {submitted && rating === -1 && (
        <span className="text-xs text-muted-foreground ml-2">Thanks for the feedback</span>
      )}
    </div>
  );
}
