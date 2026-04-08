'use client';

import { UIMessage } from 'ai';
import { useRef, useEffect } from 'react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';

// ── Markdown styling ──────────────────────────────────────────────────────────
// Custom element renderers for assistant messages. Tailwind v4 here does not
// include the typography plugin, so we style each element explicitly rather
// than relying on `prose` classes.
const markdownComponents: Components = {
  p: ({ children }) => <p className="my-1.5 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 pl-5 list-disc space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 pl-5 list-decimal space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-medium text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => <h1 className="text-base font-semibold text-foreground mt-3 mb-1.5 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-semibold text-foreground mt-3 mb-1.5 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold text-foreground mt-2 mb-1 first:mt-0">{children}</h3>,
  a: ({ children, href }) => (
    <a href={href} className="text-primary hover:underline" target={href?.startsWith('http') ? '_blank' : undefined} rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}>
      {children}
    </a>
  ),
  code: ({ children }) => <code className="px-1 py-0.5 rounded bg-muted text-foreground text-xs font-mono">{children}</code>,
  hr: () => <hr className="my-3 border-border" />,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-border pl-3 italic text-foreground/80 my-1.5">{children}</blockquote>,
};
import { TappableOptions } from './TappableOptions';
import { ChatCTA } from './ChatCTA';
import { StructuredInput, StructuredInputConfig } from './StructuredInput';
import { ScenarioResult } from './ScenarioResult';
import { TripPlanResult } from './TripPlanResult';
import { MessageFeedback } from './MessageFeedback';

// ── Tool loading labels ───────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  get_spending_summary: 'Looking up your spending...',
  compare_months: 'Comparing those months...',
  get_value_breakdown: 'Analysing your value breakdown...',
  calculate_monthly_budget: 'Calculating your budget...',
  get_action_items: 'Checking your action items...',
  create_action_item: 'Creating that action item...',
  model_scenario: 'Running the numbers on that scenario...',
  analyse_gap: 'Comparing your values with reality...',
  suggest_value_recategorisation: 'Looking for miscategorised transactions...',
  update_value_category: 'Updating your value categories...',
  update_user_profile: 'Saving to your profile...',
  plan_trip: 'Planning your trip...',
  search_bill_alternatives: 'Researching alternatives...',
};

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
  // Accept both inline ([CTA:type]label[/CTA]) and multi-line variants.
  // [\s\S] so the label can span newlines; the optional \s* lets us match either form.
  const regex = /\[CTA:(\w+)\]\s*([\s\S]*?)\s*\[\/CTA\]/;
  const match = content.match(regex);
  if (!match) return { text: content, cta: null };
  const label = match[2].trim();
  if (!label) return { text: content, cta: null };
  return {
    text: content.replace(regex, '').trim(),
    cta: { type: match[1], label },
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
  onStructuredSubmit,
  userCurrency,
}: {
  messages: UIMessage[];
  status: string;
  onOptionSelect?: (text: string) => void;
  onStructuredSubmit?: (field: string, value: string | number, displayText: string) => void;
  userCurrency?: string;
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
        // Extract text parts and structured input tool invocations
        const textParts: string[] = [];
        const structuredInputs: StructuredInputConfig[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const scenarioResults: any[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tripPlanResults: any[] = [];

        const toolInvocations: Array<{ toolName: string; state: string; toolCallId: string }> = [];

        if (message.parts) {
          for (const part of message.parts) {
            if (part.type === 'text') {
              textParts.push((part as { type: 'text'; text: string }).text);
            } else if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
              // AI SDK v5+ tool part format: type="tool-{toolName}", state="input-available"|"output-available"|"output-error"
              const toolName = part.type.slice('tool-'.length);
              const toolPart = part as unknown as {
                type: string;
                state: string;
                toolCallId?: string;
                input?: unknown;
                output?: unknown;
                errorText?: string;
              };
              const toolCallId = toolPart.toolCallId ?? `${toolName}-${textParts.length}`;

              // Track in-progress tool calls for loading indicators
              if (
                (toolPart.state === 'input-streaming' || toolPart.state === 'input-available') &&
                TOOL_LABELS[toolName]
              ) {
                toolInvocations.push({ toolName, state: toolPart.state, toolCallId });
              }

              // Handle completed tool results
              if (toolPart.state === 'output-available') {
                const output = toolPart.output;

                // Structured input component
                if (
                  toolName === 'request_structured_input' &&
                  output &&
                  typeof output === 'object' &&
                  (output as { type?: string }).type === 'structured_input'
                ) {
                  structuredInputs.push(output as StructuredInputConfig);
                }

                // Scenario result visualisation
                if (
                  toolName === 'model_scenario' &&
                  output &&
                  typeof output === 'object' &&
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (output as any).scenario &&
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  !(output as any).error
                ) {
                  scenarioResults.push(output);
                }

                // Trip plan visualisation
                if (
                  toolName === 'plan_trip' &&
                  output &&
                  typeof output === 'object' &&
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (output as any).type === 'trip_plan'
                ) {
                  tripPlanResults.push(output);
                }

                // Clear the loading indicator for this tool
                const idx = toolInvocations.findIndex((t) => t.toolCallId === toolCallId);
                if (idx !== -1) toolInvocations.splice(idx, 1);
              }
            }
          }
        }

        const rawText = textParts.join('');

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
                    : 'text-sm text-foreground/90 px-3 overflow-hidden break-words'
                }
              >
                {message.role === 'assistant' ? (
                  <Markdown components={markdownComponents}>{text}</Markdown>
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

              {/* Structured input components from tool invocations */}
              {structuredInputs.map((config, i) => (
                <StructuredInput
                  key={`${config.field}-${i}`}
                  config={config}
                  onSubmit={onStructuredSubmit ?? (() => {})}
                  userCurrency={userCurrency}
                />
              ))}

              {/* Scenario result visualisations */}
              {scenarioResults.map((result, i) => (
                <div key={`scenario-${i}`} className="px-3 mt-2">
                  <ScenarioResult result={result} />
                </div>
              ))}

              {/* Trip plan result visualisations */}
              {tripPlanResults.map((result, i) => (
                <div key={`trip-${i}`} className="px-3">
                  <TripPlanResult result={result} />
                </div>
              ))}

              {/* Tool loading indicators */}
              {toolInvocations.map((tool) => (
                <div
                  key={tool.toolCallId}
                  className="flex items-center gap-2 text-xs text-muted-foreground py-1.5 px-3"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse flex-shrink-0" />
                  {TOOL_LABELS[tool.toolName]}
                </div>
              ))}

              {/* Message feedback (assistant messages with DB IDs only) */}
              {message.role === 'assistant' &&
                !!((message.metadata as { messageDbId?: string } | null)?.messageDbId) && (
                  <div className="px-3">
                    <MessageFeedback messageId={(message.metadata as { messageDbId: string }).messageDbId} />
                  </div>
                )}
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
