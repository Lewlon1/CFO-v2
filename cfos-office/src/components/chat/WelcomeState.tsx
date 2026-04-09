'use client';

import { useEffect } from 'react';
import {
  NEW_USER_PROMPTS,
  RETURNING_USER_PROMPTS,
  type PromptButton,
} from '@/lib/chat/prompt-buttons';
import { useTrackEvent } from '@/lib/events/use-track-event';

export function WelcomeState({
  onSelect,
  hasTransactions = false,
}: {
  onSelect: (text: string, conversationType?: string) => void;
  hasTransactions?: boolean;
}) {
  const trackEvent = useTrackEvent();
  const prompts = hasTransactions ? RETURNING_USER_PROMPTS : NEW_USER_PROMPTS;
  const userType = hasTransactions ? 'returning' : 'new';

  useEffect(() => {
    trackEvent('prompt_buttons_viewed', 'engagement', {
      user_type: userType,
      has_transactions: hasTransactions,
      prompt_count: prompts.length,
      prompt_ids: prompts.map((p) => p.id),
    });
    // Fire once per mount. WelcomeState only mounts when the chat is
    // in its empty state, so this is the correct impression signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClick = (prompt: PromptButton) => {
    trackEvent('prompt_button_clicked', 'engagement', {
      prompt_id: prompt.id,
      prompt_label: prompt.label,
      prompt_position: prompt.order,
      user_type: userType,
      has_transactions: hasTransactions,
    });
    onSelect(prompt.message, prompt.conversationType);
  };

  return (
    <div className="flex-1 flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <div className="w-14 h-14 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-5">
          <div className="w-8 h-8 rounded-sm bg-primary flex items-center justify-center text-primary-foreground font-bold text-lg">
            £
          </div>
        </div>
        <h1 className="text-xl font-semibold text-foreground mb-2">
          Welcome to the CFO&apos;s Office
        </h1>
        <p className="text-sm text-muted-foreground mb-8">
          Your personal finance advisor. What would you like to talk about?
        </p>
        <div className="grid gap-2">
          {prompts.map((prompt) => (
            <button
              key={prompt.id}
              onClick={() => handleClick(prompt)}
              className="w-full px-4 py-3 text-left text-sm text-foreground/80 bg-card border border-border rounded-xl hover:bg-accent hover:text-foreground transition-colors"
            >
              {prompt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
