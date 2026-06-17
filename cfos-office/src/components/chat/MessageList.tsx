'use client';

import { UIMessage } from 'ai';
import { useRef, useEffect } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { ResonanceTap } from './ResonanceTap';
import { trackWowEvent } from '@/lib/wow/event-tracker';

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
  em: ({ children }) => <em className="font-serif italic">{children}</em>,
  h1: ({ children }) => <h1 className="text-base text-foreground mt-3 mb-1.5 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm text-foreground mt-3 mb-1.5 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm text-foreground mt-2 mb-1 first:mt-0">{children}</h3>,
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
import { ConfirmFact } from './ConfirmFact';
import { StatCardBlock } from './StatCardBlock';
import { ChatCTA } from './ChatCTA';
import { StructuredInput, StructuredInputConfig } from './StructuredInput';
import {
  LabelTransactionsBlock,
  type LabelTransactionsBlockProps,
  type LabelTransactionsQuadrantId,
  type LabelTransactionsTransaction,
} from './LabelTransactionsBlock';
import { ScenarioResult } from './ScenarioResult';
import { TripPlanResult } from './TripPlanResult';
import { MessageFeedback } from './MessageFeedback';
import { SavedItemCard, type SavedItemCardProps } from './SavedItemCard';
import { CfoThinking } from '@/components/brand/CfoThinking';
import { CFOAvatar } from '@/components/brand/CFOAvatar';
import { ValueMapActionButton } from './ValueMapActionButton';
import { StatementCheckActionButton } from './StatementCheckActionButton';
import { isStartValueMapAction } from '@/lib/onboarding-v2/types';
import { hasStartValueMapAction, stripActionMarkers } from '@/lib/onboarding-v2/bridge';
import { parseOptions } from '@/lib/chat/options-parser';
import { parseConfirmFact } from '@/lib/chat/confirm-fact-parser';
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
  plan_event: 'Planning your event...',
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

// ── Wow plumbing: first-insight delivery instrumentation ───────────────────
//
// Mounts under the first persisted assistant message in a first_read
// conversation. Fires:
//   - `delivered` on mount (idempotent server-side via partial unique index)
//   - `scrolled_to_bottom` once the bottom of the message becomes visible
// Also registers the delivery with the ChatProvider so handleSend can
// associate substantive replies back to this insight.
function FirstInsightInstrumentation({
  first_read_message_id,
  conversation_id,
  registerFirstReadDelivery,
}: {
  first_read_message_id: string;
  conversation_id: string;
  registerFirstReadDelivery?: (ctx: {
    first_read_message_id: string;
    conversation_id: string;
  }) => void;
}) {
  const bottomSentinelRef = useRef<HTMLDivElement>(null);

  // Fire delivered + register once when mounted for this insight id.
  useEffect(() => {
    void trackWowEvent({
      event_type: 'delivered',
      first_read_message_id,
      conversation_id,
    });
    registerFirstReadDelivery?.({ first_read_message_id, conversation_id });
  }, [first_read_message_id, conversation_id, registerFirstReadDelivery]);

  // Scroll-to-bottom observer. The sentinel sits just below the message body;
  // once it's at least 50% visible we count the user as having scrolled past it.
  useEffect(() => {
    const el = bottomSentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            void trackWowEvent({
              event_type: 'scrolled_to_bottom',
              first_read_message_id,
              conversation_id,
            });
            observer.disconnect();
            return;
          }
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [first_read_message_id, conversation_id]);

  return <div ref={bottomSentinelRef} aria-hidden className="h-px w-full" />;
}

function parseMessageContent(rawContent: string): {
  text: string;
  options: string[] | null;
  cta: { type: string; label: string } | null;
  confirmFact: string | null;
  stats: Array<{ label: string; value: string }>;
} {
  // Strip the <ACTION:start_value_map> token so it doesn't render as visible
  // text during the live stream. The server also strips before persisting,
  // so this is idempotent on reload.
  const stripped = stripActionMarkers(rawContent);
  // Order matters: extract stats first so the [STATS] block is stripped
  // before any downstream parsers (or markdown) see it.
  const withStats = extractStats(stripped);
  const withConfirm = parseConfirmFact(withStats.text);
  const withOptions = parseOptions(withConfirm.text);
  const withCTA = parseCTA(withOptions.text);
  return {
    text: withCTA.text,
    options: withOptions.options,
    cta: withCTA.cta,
    confirmFact: withConfirm.confirmFact,
    stats: withStats.stats,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MessageList({
  messages,
  status,
  onOptionSelect,
  onStructuredSubmit,
  onLabelTransactionsSubmit,
  userCurrency,
  conversationType,
  conversationId,
  registerFirstReadDelivery,
}: {
  messages: UIMessage[];
  status: string;
  onOptionSelect?: (text: string) => void;
  onStructuredSubmit?: (field: string, value: string | number, displayText: string) => void;
  onLabelTransactionsSubmit?: (
    transactions: LabelTransactionsTransaction[],
    labels: Record<string, LabelTransactionsQuadrantId>,
  ) => void;
  userCurrency?: string;
  conversationType?: string | null;
  conversationId?: string | null;
  registerFirstReadDelivery?: (ctx: {
    first_read_message_id: string;
    conversation_id: string;
  }) => void;
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

  // Wow plumbing: the first persisted assistant message in a first_read
  // conversation is the "first Read" delivery. Identify its DB id once so we
  // can render ResonanceTap + scroll observer + delivered/chip tracking on it.
  // Pre-layered first_read conversations also flow through this branch,
  // which is fine — the server-side cron only aggregates layered ones, so
  // extra events on legacy conversations are harmlessly written and ignored.
  let firstReadMsgDbId: string | null = null;
  if (conversationType === 'first_read' && conversationId) {
    for (const m of visibleMessages) {
      if (m.role !== 'assistant') continue;
      const dbId = (m.metadata as { messageDbId?: string } | null)?.messageDbId;
      if (dbId) {
        firstReadMsgDbId = dbId;
        break;
      }
    }
  }

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 space-y-6 min-h-0 overscroll-contain">
      {visibleMessages.map((message) => {
        // Extract text parts and structured input tool invocations
        const textParts: string[] = [];
        const structuredInputs: StructuredInputConfig[] = [];
        const labelTransactionsConfigs: LabelTransactionsBlockProps[] = [];
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

                // Inline labelling block (label_transactions tool).
                // The render_directive guard distinguishes successful tool
                // output from error-shape outputs ({ error: '...' }).
                if (
                  toolName === 'label_transactions' &&
                  output &&
                  typeof output === 'object' &&
                  (output as { render_directive?: string }).render_directive === 'label_transactions'
                ) {
                  labelTransactionsConfigs.push(output as LabelTransactionsBlockProps);
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

                // Event plan visualisation (trips + celebrations + gifts + other)
                if (
                  toolName === 'plan_event' &&
                  output &&
                  typeof output === 'object' &&
                  (output as { type?: unknown }).type === 'event_plan'
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

        const { text, options, cta, confirmFact, stats } = message.role === 'assistant'
          ? parseMessageContent(rawText)
          : { text: rawText, options: null, cta: null, confirmFact: null, stats: [] as Array<{ label: string; value: string }> };

        // Wow plumbing: is THIS message the first-Read delivery?
        const messageDbIdValue = (message.metadata as { messageDbId?: string } | null)?.messageDbId;
        const isFirstInsightMessage =
          message.role === 'assistant' &&
          !!firstReadMsgDbId &&
          !!messageDbIdValue &&
          messageDbIdValue === firstReadMsgDbId &&
          !!conversationId;

        const optionSelectHandler =
          isFirstInsightMessage && onOptionSelect
            ? (chipText: string) => {
                void trackWowEvent({
                  event_type: 'chip_tapped',
                  first_read_message_id: firstReadMsgDbId as string,
                  conversation_id: conversationId as string,
                  metadata: { chip_text: chipText },
                });
                onOptionSelect(chipText);
              }
            : onOptionSelect;

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
                  <CFOAvatar size={20} className="flex-shrink-0" />
                  <span className="text-xs text-muted-foreground font-medium">
                    Your CFO
                  </span>
                </div>
              )}
              <div
                className={
                  message.role === 'user'
                    ? 'text-sm text-foreground font-sans'
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

              {/* Fact-confirmation: when present, the Yes/Not-quite tap renders
                  first and the option chips are revealed only after it's
                  answered. Without a confirmFact, options render as before. */}
              {confirmFact && optionSelectHandler ? (
                <ConfirmFact
                  fact={confirmFact}
                  options={options}
                  onSelect={optionSelectHandler}
                />
              ) : (
                options && optionSelectHandler && (
                  <TappableOptions options={options} onSelect={optionSelectHandler} />
                )
              )}

              {/* CTA block — action-type CTAs (supply_input, cut_lever, etc.)
                  re-use the OPTIONS chip-tap handler so wow tracking + chat
                  send stay in one place. value_checkin (the existing deep-link)
                  ignores onAction and renders its Link as before. */}
              {cta && (
                <ChatCTA
                  type={cta.type}
                  label={cta.label}
                  onAction={optionSelectHandler}
                />
              )}

              {/* Onboarding v2 — Value Map action button. Renders when either
                  the persisted metadata stamps the action (post-stream) OR the
                  streaming text contains the literal token (during stream,
                  before metadata propagates). Both paths are idempotent. */}
              {message.role === 'assistant' &&
                (() => {
                  const actions = (message.metadata as { actions_created?: unknown } | null)?.actions_created
                  const fromMetadata = Array.isArray(actions) && actions.some(isStartValueMapAction)
                  const fromStream = hasStartValueMapAction(rawText)
                  return (fromMetadata || fromStream) ? (
                    <div className="px-3">
                      <ValueMapActionButton />
                    </div>
                  ) : null
                })()}

              {/* Onboarding v2 — value-first hook close. The first Read's
                  composed message ends with a [CTA:start_value_map_real] token
                  (parsed into `cta`); ChatCTA has no handler for it, so we
                  render the real-transactions Value Map invite inline here. */}
              {message.role === 'assistant' && cta?.type === 'start_value_map_real' && (
                <div className="px-3">
                  <ValueMapActionButton variant="real" />
                </div>
              )}

              {/* Onboarding v2 (OB-2) — the estimate Read closes on a
                  [CTA:start_statement_check] token; render the statement-check
                  invite inline (same pattern as start_value_map_real). */}
              {message.role === 'assistant' && cta?.type === 'start_statement_check' && (
                <div className="px-3">
                  <StatementCheckActionButton />
                </div>
              )}

              {/* Structured input components from tool invocations */}
              {structuredInputs.map((config, i) => (
                <StructuredInput
                  key={`${config.field}-${i}`}
                  config={config}
                  onSubmit={onStructuredSubmit ?? (() => {})}
                  userCurrency={userCurrency}
                />
              ))}

              {/* Inline label_transactions blocks. The block POSTs each
                  label to /api/corrections/signal itself; onSubmit then fires
                  a hidden [System: ...] trigger so the CFO acknowledges the
                  labels in the next turn (see ChatProvider.handleLabelTransactionsSubmit). */}
              {labelTransactionsConfigs.map((config) => (
                <LabelTransactionsBlock
                  key={config.directiveId}
                  {...config}
                  userCurrency={userCurrency}
                  onSubmit={(labels) =>
                    onLabelTransactionsSubmit?.(config.transactions, labels)
                  }
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

              {/* Wow plumbing: first-Read instrumentation + explicit tap.
                  Only renders on the first persisted assistant message in a
                  first_read conversation. The instrumentation sentinel fires
                  delivered + scrolled_to_bottom; the tap captures explicit
                  resonance feedback. */}
              {isFirstInsightMessage && firstReadMsgDbId && conversationId && (
                <div className="px-3">
                  <FirstInsightInstrumentation
                    first_read_message_id={firstReadMsgDbId}
                    conversation_id={conversationId}
                    registerFirstReadDelivery={registerFirstReadDelivery}
                  />
                  <ResonanceTap
                    first_read_message_id={firstReadMsgDbId}
                    conversation_id={conversationId}
                  />
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
