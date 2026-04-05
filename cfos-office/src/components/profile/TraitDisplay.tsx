'use client';

import { useState } from 'react';
import { X, Brain, ThumbsUp, ThumbsDown } from 'lucide-react';

type Trait = {
  id: string;
  trait_key: string;
  trait_value: string;
  trait_type: string;
  confidence: number;
  evidence: string | null;
  source: string;
};

export function TraitDisplay({ traits }: { traits: Trait[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<Map<string, 'up' | 'down'>>(new Map());
  const [adjustedConfidence, setAdjustedConfidence] = useState<Map<string, number>>(new Map());

  if (traits.length === 0) return null;

  const handleDismiss = async (traitId: string) => {
    setDismissed((prev) => new Set([...prev, traitId]));
    await fetch('/api/profile/traits/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ traitId }),
    });
  };

  const handleFeedback = async (traitId: string, accurate: boolean) => {
    const trait = traits.find((t) => t.id === traitId);
    if (!trait) return;

    const direction = accurate ? 'up' : 'down';
    setFeedback((prev) => new Map(prev).set(traitId, direction));

    // Optimistic confidence update
    const currentConfidence = adjustedConfidence.get(traitId) ?? trait.confidence;
    const newConfidence = accurate
      ? Math.min(1.0, currentConfidence + 0.15)
      : Math.max(0.1, currentConfidence - 0.3);
    setAdjustedConfidence((prev) => new Map(prev).set(traitId, newConfidence));

    const res = await fetch('/api/profile/portrait/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ traitId, accurate }),
    });

    if (!res.ok) {
      // Revert on error
      setFeedback((prev) => {
        const next = new Map(prev);
        next.delete(traitId);
        return next;
      });
      setAdjustedConfidence((prev) => {
        const next = new Map(prev);
        next.delete(traitId);
        return next;
      });
    }
  };

  const visible = traits.filter((t) => !dismissed.has(t.id));
  if (visible.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Brain className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">
          What your CFO has observed
        </h3>
      </div>
      <div className="space-y-3">
        {visible.map((trait) => {
          const confidence = adjustedConfidence.get(trait.id) ?? trait.confidence;
          const voted = feedback.get(trait.id);

          return (
            <div
              key={trait.id}
              className="flex items-start gap-3 group"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground/90">{trait.trait_value}</p>
                <div className="flex items-center gap-2 mt-1">
                  {/* Confidence indicator */}
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((dot) => (
                      <div
                        key={dot}
                        className={`w-1.5 h-1.5 rounded-full transition-colors ${
                          dot <= Math.round(confidence * 5)
                            ? 'bg-primary'
                            : 'bg-border'
                        }`}
                      />
                    ))}
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {trait.source === 'post_conversation'
                      ? 'Observed from chat'
                      : trait.source === 'user_correction_chat'
                        ? 'You confirmed'
                        : trait.source === 'value_map'
                          ? 'From Value Map'
                          : 'Inferred'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleFeedback(trait.id, true)}
                  disabled={!!voted}
                  className={`p-1 rounded min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors ${
                    voted === 'up'
                      ? 'text-green-500'
                      : voted
                        ? 'opacity-30 cursor-not-allowed'
                        : 'hover:bg-muted text-muted-foreground hover:text-green-500'
                  }`}
                  title="Accurate"
                >
                  <ThumbsUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleFeedback(trait.id, false)}
                  disabled={!!voted}
                  className={`p-1 rounded min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors ${
                    voted === 'down'
                      ? 'text-amber-500'
                      : voted
                        ? 'opacity-30 cursor-not-allowed'
                        : 'hover:bg-muted text-muted-foreground hover:text-amber-500'
                  }`}
                  title="Not quite"
                >
                  <ThumbsDown className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDismiss(trait.id)}
                  className="p-1 rounded hover:bg-muted transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100"
                  title="Dismiss this observation"
                >
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
