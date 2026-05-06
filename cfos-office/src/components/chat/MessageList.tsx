'use client';

import { UIMessage } from 'ai';
import { useRef, useEffect } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
  table: ({ children }) => (
    <div className="overflow-x-auto my-3 -mx-1">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-border">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-border/50">{children}</tbody>,
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children }) => (
    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 text-sm text-foreground/90 whitespace-nowrap">{children}</td>
  ),
};
import { TappableOptions } from './TappableOptions';
import { StatCardBlock } from './StatCardBlock';
import { ChatCTA } from './ChatCTA';
import { StructuredInput, StructuredInputConfig } from './StructuredInput';
import { ScenarioResult } from './ScenarioResult';
import { TripPlanResult } from './TripPlanResult';
import { MessageFeedback } from './MessageFeedback';
import { SavedItemCard, type SavedItemCardProps } from './SavedItemCard';
import { CfoThinking } from '@/components/brand/CfoThinking';
import {
  buildActionItemCard,
  buildProfileUpdateCard,
  buildAssetOrLiabilityCard,
  buildValueCategoryCard,
  buildClassificationsCard,
} from './savedCardBuilders';

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

const STATS_BLOCK = /\[STATS\]([\s\S]*?)\[\/STATS\]/g;

function extractStats(text: string): {
  text: string;
  stats: Array<{ label: string; value: string }>;
} {
  const stats: Array<{ label: string; value: string }> = [];
  const cleaned = text.replace(STATS_BLOCK, (_, body) => {
    for (const line of String(body).split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [label, value] = trimmed.split('|').map((s) => s.trim());
      if (label && value) stats.push({ label, value });
    }
    return ''; // strip the block from rendered text
  });
  return { text: cleaned, stats };
}

function parseOptions(content: string): { text: string; options: string[] | null } {
  // Primary: explicit [OPTIONS] blocks. Accept both closed and unclosed forms
  // — Claude frequently forgets the trailing [/OPTIONS] tag.
  const markerMatch = content.match(/\[OPTIONS\]\s*\n/);
  if (markerMatch && markerMatch.index !== undefined) {
    const markerStart = markerMatch.index;
    const afterMarker = markerStart + markerMatch[0].length;
    const tail = content.slice(afterMarker);
    const lines = tail.split('\n');

    const bulletLines: string[] = [];
    let consumedLines = 0;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        // Blank lines inside the block are allowed only between bullets.
        if (bulletLines.length === 0 || consumedLines === lines.length - 1) {
          consumedLines++;
          continue;
        }
        consumedLines++;
        continue;
      }
      if (/^[-•]\s+/.test(line)) {
        bulletLines.push(line.replace(/^[-•]\s*/, '').trim());
        consumedLines++;
      } else {
        break;
      }
    }

    // Trim trailing blank lines back off the consumed count so we don't eat
    // a blank separator that belongs to prose after the block.
    while (consumedLines > 0 && lines[consumedLines - 1].trim() === '') {
      consumedLines--;
    }

    if (bulletLines.length > 0 && bulletLines.length <= 5) {
      const consumedText = lines.slice(0, consumedLines).join('\n');
      // +1 for the newline after the last consumed line, if there is one.
      const hasTrailingNewline = consumedLines < lines.length;
      const consumedLength = consumedText.length + (hasTrailingNewline ? 1 : 0);

      let removeEnd = afterMarker + consumedLength;
      // Also consume an optional closing [/OPTIONS] tag immediately after.
      const closingMatch = content.slice(removeEnd).match(/^\s*\[\/OPTIONS\]\s*\n?/);
      if (closingMatch) {
        removeEnd += closingMatch[0].length;
      }

      const text = (content.slice(0, markerStart) + content.slice(removeEnd))
        .replace(/\[\/?OPTIONS\]/g, '')
        .trim();
      return { text, options: bulletLines };
    }
  }

  // Fallback: trailing bullet list of 2-4 short items that don't look like data.
  // The LLM sometimes forgets the explicit block — this catches "Would you like
  // to..." style responses while skipping spending breakdowns (monetary values).
  // Allow optional blank lines between bullets (markdown-style paragraphs).
  const trailing = content.match(/\n((?:[-•]\s+.{3,60}(?:\n\s*)?){2,4})$/);
  if (trailing) {
    const items = trailing[1]
      .split('\n')
      .map((l) => l.replace(/^[-•]\s*/, '').trim())
      .filter(Boolean);
    const looksLikeChoices = items.every(
      (i) => i.length <= 60 && !/\d{2,}[.,]\d{2}/.test(i)
    );
    if (looksLikeChoices && items.length >= 2 && items.length <= 4) {
      const text = content
        .slice(0, content.length - trailing[0].length)
        .replace(/\[\/?OPTIONS\]/g, '')
        .trim();
      return { text, options: items };
    }
  }

  return { text: content, options: null };
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
  stats: Array<{ label: string; value: string }>;
} {
  // Order matters: extract stats first so the [STATS] block is stripped
  // before any downstream parsers (or markdown) see it.
  const withStats = extractStats(rawContent);
  const withOptions = parseOptions(withStats.text);
  const withCTA = parseCTA(withOptions.text);
  return {
    text: withCTA.text,
    options: withOptions.options,
    cta: withCTA.cta,
    stats: withStats.stats,
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
    <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 space-y-6 min-h-0 overscroll-contain">
      {visibleMessages.map((message) => {
        // Extract text parts and structured input tool invocations
        const textParts: string[] = [];
        const structuredInputs: StructuredInputConfig[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const scenarioResults: any[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tripPlanResults: any[] = [];
        const savedCards: Array<SavedItemCardProps & { toolCallId: string }> = [];

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
                  'scenario' in output &&
                  (output as { scenario?: unknown }).scenario &&
                  !('error' in output && (output as { error?: unknown }).error)
                ) {
                  scenarioResults.push(output);
                }

                // Trip plan visualisation
                if (
                  toolName === 'plan_trip' &&
                  output &&
                  typeof output === 'object' &&
                  (output as { type?: unknown }).type === 'trip_plan'
                ) {
                  tripPlanResults.push(output);
                }

                // Saved-item confirmation cards for write tools
                if (output && typeof output === 'object') {
                  // The downstream card builders expect a record-like shape; the
                  // tool outputs here are validated server-side against zod schemas
                  // before reaching the client, so dynamic keying is safe.
                  const o = output as Record<string, unknown>;
                  if (toolName === 'create_action_item' && o.success && o.action_item) {
                    savedCards.push(buildActionItemCard(o, toolCallId));
                  } else if (
                    toolName === 'update_user_profile' &&
                    Array.isArray(o.saved) &&
                    o.saved.length > 0
                  ) {
                    savedCards.push(buildProfileUpdateCard(o, toolCallId));
                  } else if (
                    (toolName === 'upsert_asset' || toolName === 'upsert_liability') &&
                    o.saved &&
                    !o.error
                  ) {
                    savedCards.push(
                      buildAssetOrLiabilityCard(
                        toolName as 'upsert_asset' | 'upsert_liability',
                        o,
                        toolCallId,
                      ),
                    );
                  } else if (toolName === 'update_value_category' && o.success) {
                    savedCards.push(buildValueCategoryCard(o, toolCallId));
                  } else if (
                    toolName === 'record_value_classifications' &&
                    typeof o.classified === 'number' &&
                    o.classified > 0
                  ) {
                    savedCards.push(buildClassificationsCard(o, toolCallId));
                  }
                }

                // Clear the loading indicator for this tool
                const idx = toolInvocations.findIndex((t) => t.toolCallId === toolCallId);
                if (idx !== -1) toolInvocations.splice(idx, 1);
              }
            }
          }
        }

        // Join streamed text parts, preserving whitespace at tool-call boundaries.
        // When Claude emits `text → tool-call → text`, the adjacent text chunks
        // can lose the whitespace that would have surrounded the tool call.
        const rawText = textParts.reduce((acc, part, i) => {
          if (i === 0) return part;
          const needsSpace = acc.length > 0 && !/\s$/.test(acc) && !/^\s/.test(part);
          return acc + (needsSpace ? ' ' : '') + part;
        }, '');

        const { text, options, cta, stats } = message.role === 'assistant'
          ? parseMessageContent(rawText)
          : { text: rawText, options: null, cta: null, stats: [] as Array<{ label: string; value: string }> };

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
                    : 'text-sm text-foreground/90 px-3 break-words'
                }
              >
                {message.role === 'assistant' ? (
                  <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{text}</Markdown>
                ) : (
                  <p className="whitespace-pre-wrap">{text}</p>
                )}
              </div>

              {/* Stat cards from [STATS] block (assistant only) */}
              {message.role === 'assistant' && stats.length > 0 && (
                <StatCardBlock cards={stats} />
              )}

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

              {/* Saved-item confirmation cards (write tools) */}
              {savedCards.map((card) => (
                <div key={`saved-${card.toolCallId}`} className="px-3 mt-2">
                  <SavedItemCard {...card} />
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
            <CfoThinking
              className="px-1 py-1"
              labels={[
                'Your CFO is reading this\u2026',
                'Pulling the right numbers\u2026',
                'Writing you back\u2026',
              ]}
            />
          </div>
        )}

      <div ref={bottomRef} />
    </div>
  );
}
