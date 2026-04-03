'use client';

import { UIMessage } from 'ai';
import { useRef, useEffect } from 'react';
import Markdown from 'react-markdown';

export function MessageList({
  messages,
  status,
}: {
  messages: UIMessage[];
  status: string;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 space-y-6">
      {messages.map((message) => (
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
              {message.parts
                .filter((part) => part.type === 'text')
                .map((part, i) =>
                  message.role === 'assistant' ? (
                    <Markdown key={i}>{(part as { type: 'text'; text: string }).text}</Markdown>
                  ) : (
                    <p key={i} className="whitespace-pre-wrap">
                      {(part as { type: 'text'; text: string }).text}
                    </p>
                  )
                )}
            </div>
          </div>
        </div>
      ))}

      {(status === 'submitted' || status === 'streaming') &&
        messages[messages.length - 1]?.role !== 'assistant' && (
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
