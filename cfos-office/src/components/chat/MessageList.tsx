'use client';

import { UIMessage } from 'ai';
import { useRef, useEffect } from 'react';
import Markdown from 'react-markdown';
import { TappableOptions } from './TappableOptions';
import { ChatCTA } from './ChatCTA';

// ── Parsers ────────────────────────────────────────────────────────────────────

function parseOptions(content: string): { text: string; options: string[] | null } {
  const regex = /\[OPTIONS\]\n([\s\S]*?)\n\[\/OPTIONS\]/;
  const match = content.match(regex);
  if (!match) return { text: content, options: null };
  const text = content.replace(regex, '').trim();
  const options = match[1]
    .split('\n')
    .map((line) => line.replace(/^-\s*/, '').trim())
    .filter(Boolean);
  return { text, options: options.length > 0 ? options : null };
}

function parseCTA(content: string): { text: string; cta: { type: string; label: string } | null } {
  const regex = /\[CTA:(\w+)\]\n(.*?)\n\[\/CTA\]/;
  const match = content.match(regex);
  if (!match) return { text: content, cta: null };
  return {
    text: content.replace(regex, '').trim(),
    cta: { type: match[1], label: match[2].trim() },
  };
}

function parseMessageContent(rawContent: string): {
  text: string;
  options: string[] | null;
  cta: { type: string; label: string } | null;
} {
  const withOptions = parseOptions(rawContent);
  const withCTA = parseCTA(withOptions.text);
  return {
    text: withCTA.text,
    options: withOptions.options,
    cta: withCTA.cta,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MessageList({
  messages,
  status,
  onOptionSelect,
}: {
  messages: UIMessage[];
  status: string;
  onOptionSelect?: (text: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  // Filter out hidden system trigger messages
  const visibleMessages = messages.filter((m) => {
    if (m.role !== 'user') return true;
    const text = m.parts
      ?.filter((p) => p.type === 'text')
      .map((p) => (p as { type: 'text'; text: string }).text)
      .join('');
    return !text?.startsWith('[System:');
  });

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 space-y-6">
      {visibleMessages.map((message) => {
        const rawText = message.parts
          ?.filter((p) => p.type === 'text')
          .map((p) => (p as { type: 'text'; text: string }).text)
          .join('') ?? '';

        const { text, options, cta } = message.role === 'assistant'
          ? parseMessageContent(rawText)
          : { text: rawText, options: null, cta: null };

        return (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] md:max-w-[75%] overflow-hidden ${
                message.role === 'user'
                  ? 'bg-primary/10 border border-primary/20 rounded-2xl rounded-br-md px-4 py-3'
                  : 'rounded-2xl rounded-bl-md px-1 py-1'
              }`}
            >
              {message.role === 'assistant' && (
                <div className="flex items-center gap-2 mb-2 px-3">
                  <div className="w-5 h-5 rounded-sm bg-primary flex items-center justify-center text-primary-foreground font-bold text-[10px] flex-shrink-0">
                    £
                  </div>
                  <span className="text-xs text-muted-foreground font-medium">
                    Your CFO
                  </span>
                </div>
              )}
              <div
                className={
                  message.role === 'user'
                    ? 'text-sm text-foreground'
                    : 'text-sm text-foreground/90 px-3 overflow-hidden break-words prose-invert prose-sm prose-p:my-2 prose-ul:my-2 prose-li:my-0.5 prose-headings:text-foreground prose-headings:font-semibold prose-strong:text-foreground'
                }
              >
                {message.role === 'assistant' ? (
                  <Markdown>{text}</Markdown>
                ) : (
                  <p className="whitespace-pre-wrap">{text}</p>
                )}
              </div>

              {/* Tappable options */}
              {options && onOptionSelect && (
                <TappableOptions options={options} onSelect={onOptionSelect} />
              )}

              {/* CTA block */}
              {cta && <ChatCTA type={cta.type} label={cta.label} />}
            </div>
          </div>
        );
      })}

      {(status === 'submitted' || status === 'streaming') &&
        visibleMessages[visibleMessages.length - 1]?.role !== 'assistant' && (
          <div className="flex justify-start">
            <div className="px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-5 h-5 rounded-sm bg-primary flex items-center justify-center text-primary-foreground font-bold text-[10px] flex-shrink-0">
                  £
                </div>
                <span className="text-xs text-muted-foreground font-medium">
                  Your CFO
                </span>
              </div>
              <div className="flex gap-1.5 px-3 py-1">
                <span className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
                <span className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
                <span className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

      <div ref={bottomRef} />
    </div>
  );
}
