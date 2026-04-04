'use client';

import { useState } from 'react';
import { X, Brain } from 'lucide-react';

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

  if (traits.length === 0) return null;

  const handleDismiss = async (traitId: string) => {
    setDismissed((prev) => new Set([...prev, traitId]));
    await fetch('/api/profile/traits/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ traitId }),
    });
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
        {visible.map((trait) => (
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
                      className={`w-1.5 h-1.5 rounded-full ${
                        dot <= Math.round(trait.confidence * 5)
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
            <button
              onClick={() => handleDismiss(trait.id)}
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted transition-opacity min-h-[44px] min-w-[44px] flex items-center justify-center"
              title="Dismiss this observation"
            >
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
