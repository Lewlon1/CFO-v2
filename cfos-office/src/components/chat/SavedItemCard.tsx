'use client';

import { useState } from 'react';
import { Check, Undo2, X, ExternalLink } from 'lucide-react';

export interface SavedItemCardProps {
  icon?: 'check' | 'asset' | 'liability' | 'profile' | 'category' | 'tx';
  title: string;
  rows: Array<{ label: string; value: string }>;
  undo?: {
    toolName: string;
    toolCallId: string;
    payload: Record<string, unknown>;
  };
  dismissLabel?: string;
  editHref?: string;
}

type CardState = 'idle' | 'undoing' | 'undone' | 'dismissed' | 'error';

export function SavedItemCard({
  title,
  rows,
  undo,
  dismissLabel = 'Dismiss',
  editHref,
}: SavedItemCardProps) {
  const [state, setState] = useState<CardState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleUndo = async () => {
    if (!undo) return;
    setState('undoing');
    setErrorMsg(null);
    try {
      const res = await fetch('/api/chat/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: undo.toolName,
          toolCallId: undo.toolCallId,
          payload: undo.payload,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setState('undone');
      } else {
        setErrorMsg(data.error || 'Could not undo. Please try again.');
        setState('error');
      }
    } catch {
      setErrorMsg('Network error. Please try again.');
      setState('error');
    }
  };

  const handleDismiss = () => setState('dismissed');

  if (state === 'dismissed') return null;

  const isUndone = state === 'undone';

  return (
    <div
      className={`bg-card border rounded-lg px-3 py-2.5 transition-opacity ${
        isUndone ? 'border-border opacity-60' : 'border-border'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${
              isUndone ? 'bg-muted' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
            }`}
          >
            <Check className="w-3 h-3" strokeWidth={3} />
          </div>
          <p className="text-xs font-medium text-foreground truncate">
            {isUndone ? `${title} · undone` : title}
          </p>
        </div>
      </div>

      {rows.length > 0 && (
        <dl className="mt-2 space-y-0.5">
          {rows.map((row, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3 text-xs">
              <dt className="text-muted-foreground flex-shrink-0">{row.label}</dt>
              <dd
                className={`font-medium text-right truncate ${
                  isUndone ? 'text-muted-foreground line-through' : 'text-foreground'
                }`}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {errorMsg && (
        <p className="mt-2 text-xs text-destructive">{errorMsg}</p>
      )}

      {!isUndone && (
        <div className="mt-2.5 flex items-center gap-2 pt-2 border-t border-border">
          {undo ? (
            <button
              type="button"
              onClick={handleUndo}
              disabled={state === 'undoing'}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 min-h-[32px] px-1"
            >
              <Undo2 className="w-3.5 h-3.5" />
              {state === 'undoing' ? 'Undoing…' : 'Undo'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleDismiss}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors min-h-[32px] px-1"
            >
              <X className="w-3.5 h-3.5" />
              {dismissLabel}
            </button>
          )}
          {editHref && (
            <a
              href={editHref}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto min-h-[32px] px-1"
            >
              Edit
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
