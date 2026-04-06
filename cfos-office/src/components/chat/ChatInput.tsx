'use client';

import { useRef, useEffect, useCallback } from 'react';

const MAX_LENGTH = 10_000;

export function ChatInput({
  input,
  onInputChange,
  onSend,
  disabled,
}: {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  const resize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [input, resize]);

  // Auto-focus on mount — desktop only (avoid popping keyboard on mobile)
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) {
      textareaRef.current?.focus();
    }
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && input.trim()) {
        onSend();
      }
    }
  }

  const overLimit = input.length > MAX_LENGTH;
  const showCounter = input.length > 8000;

  return (
    <div className="border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="flex items-end gap-2 max-w-3xl mx-auto">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message your CFO..."
          disabled={disabled}
          maxLength={MAX_LENGTH}
          rows={1}
          className="flex-1 resize-none bg-input border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 min-h-[44px] max-h-[200px]"
        />
        <button
          onClick={onSend}
          disabled={disabled || !input.trim() || overLimit}
          className="h-[44px] w-[44px] flex-shrink-0 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
          aria-label="Send message"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
            />
          </svg>
        </button>
      </div>
      {showCounter && (
        <p className={`text-xs mt-1 text-right max-w-3xl mx-auto ${overLimit ? 'text-red-500' : 'text-muted-foreground'}`}>
          {input.length.toLocaleString()}/{MAX_LENGTH.toLocaleString()}
        </p>
      )}
    </div>
  );
}
