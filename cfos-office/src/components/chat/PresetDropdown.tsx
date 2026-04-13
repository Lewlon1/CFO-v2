'use client';

import { useEffect, useRef } from 'react';
import {
  NEW_USER_PROMPTS,
  RETURNING_USER_PROMPTS,
  type PromptButton,
} from '@/lib/chat/prompt-buttons';

export function PresetDropdown({
  hasTransactions,
  onSelect,
  onClose,
}: {
  hasTransactions: boolean;
  onSelect: (prompt: PromptButton) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const prompts = hasTransactions ? RETURNING_USER_PROMPTS : NEW_USER_PROMPTS;

  // Close on outside tap
  useEffect(() => {
    function handleTap(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleTap);
    document.addEventListener('touchstart', handleTap);
    return () => {
      document.removeEventListener('mousedown', handleTap);
      document.removeEventListener('touchstart', handleTap);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute left-0 right-0 top-full z-50 mx-2 mt-1 rounded-xl border border-border bg-card shadow-lg overflow-hidden"
    >
      <div className="max-h-[60vh] overflow-y-auto py-1">
        {prompts.map((prompt) => (
          <button
            key={prompt.id}
            onClick={() => onSelect(prompt)}
            className="w-full px-4 py-3 text-left text-sm text-foreground/80 hover:bg-accent hover:text-foreground transition-colors min-h-[44px]"
          >
            {prompt.label}
          </button>
        ))}
      </div>
      <div className="border-t border-border px-4 py-2.5">
        <p className="text-xs text-muted-foreground text-center">
          Or type your own question below
        </p>
      </div>
    </div>
  );
}
