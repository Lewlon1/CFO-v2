import { streamText, generateText, convertToModelMessages, UIMessage, stepCountIs } from 'ai';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { chatModel } from '@/lib/ai/provider';
import { buildSystemPrompt } from '@/lib/ai/context-builder';
import { createClient } from '@/lib/supabase/server';
import { calculateProfileCompleteness } from '@/lib/profiling/engine';
import { createToolbox, type ToolContext } from '@/lib/ai/tools';

export const maxDuration = 60;

// Fields that the update_user_profile tool is allowed to write
const ALLOWED_PROFILE_FIELDS = new Set([
  'display_name', 'country', 'city', 'primary_currency', 'age_range',
  'employment_status', 'gross_salary', 'net_monthly_income', 'pay_frequency',
  'has_bonus_months', 'bonus_month_details', 'housing_type', 'monthly_rent',
  'relationship_status', 'partner_employment_status', 'partner_monthly_contribution',
  'dependents', 'values_ranking', 'spending_triggers', 'risk_tolerance',
  'financial_awareness', 'advice_style', 'nationality', 'residency_status',
  'tax_residency_country', 'years_in_country',
]);

export async function POST(req: Request) {
  try {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const MAX_MESSAGE_LENGTH = 10_000;
  const { messages, conversationId, conversationType: requestedType, conversationMetadata: requestedMetadata } = (await req.json()) as {
    messages: UIMessage[];
    conversationId: string | null;
    conversationType?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conversationMetadata?: Record<string, any>;
  };

  // Validate message length
  const lastMsg = messages[messages.length - 1];
  if (lastMsg?.role === 'user') {
    const textLength = (lastMsg.parts ?? [])
      .filter((p: { type: string }) => p.type === 'text')
      .reduce((sum: number, p: { type: string; text?: string }) => sum + (p.text?.length ?? 0), 0);
    if (textLength > MAX_MESSAGE_LENGTH) {
      return new Response('Message too long. Please keep messages under 10,000 characters.', { status: 413 });
    }
  }

  // Fetch existing conversation to get type + metadata (if one exists)
  let conversationType: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let conversationMetadata: Record<string, any> | null = null;
  if (conversationId) {
    const { data: conv } = await supabase
      .from('conversations')
      .select('type, metadata')
      .eq('id', conversationId)
      .eq('user_id', user.id)
      .single();
    if (conv) {
      conversationType = conv.type ?? undefined;
      conversationMetadata = conv.metadata ?? null;
    }
  } else if (requestedType) {
    // New conversation with a specific type (e.g. trip_planning, scenario)
    conversationType = requestedType;
    conversationMetadata = requestedMetadata ?? null;
  }

  // Build dynamic system prompt
  const systemPrompt = await buildSystemPrompt(user.id, conversationType, conversationMetadata);

  // Create or reuse conversation
  let activeConversationId = conversationId;
  if (!activeConversationId) {
    // Mark existing active conversations as completed
    const { data: completedConvs } = await supabase
      .from('conversations')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('status', 'active')
      .select('id');

    // Fire-and-forget post-conversation analysis for completed conversations
    if (completedConvs && completedConvs.length > 0) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      for (const conv of completedConvs) {
        fetch(`${appUrl}/api/analyze-conversation`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            conversation_id: conv.id,
            user_id: user.id,
          }),
        }).catch(() => {
          // Fire-and-forget — don't block conversation creation
        });
      }

      // Stamp reviewed_at on any monthly review snapshots that were just completed
      const completedIds = completedConvs.map(c => c.id);
      void supabase
        .from('monthly_snapshots')
        .update({ reviewed_at: new Date().toISOString() })
        .in('review_conversation_id', completedIds)
        .is('reviewed_at', null)
        .then(() => {});
    }

    const newType = requestedType || 'general';
    const { data, error } = await supabase
      .from('conversations')
      .insert({
        user_id: user.id,
        title: 'New conversation',
        type: newType,
        ...(requestedMetadata ? { metadata: requestedMetadata } : {}),
      })
      .select('id')
      .single();

    if (error || !data) {
      console.error('[chat] conversation insert failed:', error);
      return new Response('Failed to create conversation', { status: 500 });
    }
    activeConversationId = data.id;
  }

  // Save the user's latest message (skip hidden system trigger messages)
  const lastUserMessage = messages[messages.length - 1];
  if (lastUserMessage?.role === 'user') {
    const textContent = extractTextFromParts(lastUserMessage);
    if (textContent && !textContent.startsWith('[System:')) {
      await supabase.from('messages').insert({
        conversation_id: activeConversationId,
        user_id: user.id,
        role: 'user',
        content: textContent,
      });
    }
  }

  // Fetch user currency for tool context
  const { data: profileForCurrency } = await supabase
    .from('user_profiles')
    .select('primary_currency')
    .eq('id', user.id)
    .single();

  const toolCtx: ToolContext = {
    supabase,
    userId: user.id,
    conversationId: activeConversationId!,
    currency: profileForCurrency?.primary_currency || 'EUR',
  };

  const toolbox = createToolbox(toolCtx);

  // Convert UI messages to model format
  const modelMessages = await convertToModelMessages(messages);

  // Pre-generate DB ID for the assistant message so we can stream it to the client
  const assistantMessageDbId = crypto.randomUUID();

  // Stream response
  const result = streamText({
    model: chatModel,
    system: systemPrompt,
    messages: modelMessages,
    tools: {
      get_current_date: {
        description:
          'Get the current date and time. Use when the user asks what day or time it is.',
        inputSchema: z.object({}),
        execute: async () => {
          return {
            date: new Date().toISOString(),
            day: new Date().toLocaleDateString('en-GB', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            }),
          };
        },
      },
      update_value_category: {
        description:
          'Update the value category for a spending category based on user feedback. Use when the user tells you a category should be classified differently (e.g. "dining is an investment for me, not a leak").',
        inputSchema: z.object({
          category_slug: z
            .string()
            .describe('The traditional category slug (e.g. "eat_drinking_out", "health", "subscriptions")'),
          value_category: z
            .enum(['foundation', 'burden', 'investment', 'leak'])
            .describe('The value category the user wants this to be'),
          reason: z
            .string()
            .optional()
            .describe('Brief note on why the user sees it this way'),
        }),
        execute: async ({ category_slug, value_category, reason }) => {
          // Upsert the rule (user-confirmed = confidence 1.0)
          const { error: ruleError } = await supabase
            .from('value_category_rules')
            .upsert(
              {
                user_id: user.id,
                match_type: 'category_id',
                match_value: category_slug,
                value_category,
                confidence: 1.0,
                source: 'user_correction_chat',
              },
              { onConflict: 'user_id,match_type,match_value' },
            );

          if (ruleError) {
            console.error('update_value_category rule error:', ruleError);
          }

          // Update existing non-confirmed transactions in this category
          const { data: category } = await supabase
            .from('categories')
            .select('id')
            .eq('id', category_slug)
            .single();

          if (category) {
            await supabase
              .from('transactions')
              .update({ value_category })
              .eq('user_id', user.id)
              .eq('category_id', category_slug)
              .eq('user_confirmed', false);
          }

          // Save a portrait trait about this preference
          await supabase.from('financial_portrait').upsert(
            {
              user_id: user.id,
              trait_type: 'value_preference',
              trait_key: `value_pref_${category_slug}`,
              trait_value: `User sees ${category_slug} as ${value_category}${reason ? `: ${reason}` : ''}`,
              confidence: 1.0,
              evidence: JSON.stringify({ category_slug, value_category, reason }),
              source: 'user_correction_chat',
            },
            { onConflict: 'user_id,trait_key' },
          );

          return {
            success: true,
            message: `Updated ${category_slug} to "${value_category}". Your transactions have been updated to reflect this.`,
          };
        },
      },

      // ── Channel B: Update user profile from conversation ─────────────
      update_user_profile: {
        description:
          "Save confirmed profile information to the user's profile. IMPORTANT: Only call this AFTER the user has explicitly confirmed the information is correct. Before calling this tool, you must say what you understood (e.g. 'Your monthly rent is €1,200 — should I save that?') and wait for a yes. If they correct you, adjust and re-confirm before calling. Set confidence to 1.0 for user-confirmed data.\n\nValid field names and expected types:\n- display_name (text)\n- country (text, e.g. 'Spain')\n- city (text)\n- primary_currency (text, e.g. 'EUR')\n- age_range (text, e.g. '31-35')\n- employment_status (text, e.g. 'employed', 'self_employed', 'freelance')\n- gross_salary (number, annual)\n- net_monthly_income (number, monthly take-home)\n- pay_frequency (text, e.g. 'monthly', 'monthly_with_extra_payments')\n- has_bonus_months (boolean)\n- bonus_month_details (text)\n- housing_type (text, e.g. 'renting', 'owned')\n- monthly_rent (number, monthly rent or mortgage payment)\n- relationship_status (text, e.g. 'single', 'partnered', 'married')\n- partner_employment_status (text)\n- partner_monthly_contribution (number)\n- dependents (number, count of dependents)\n- values_ranking (text)\n- spending_triggers (text)\n- risk_tolerance (text, e.g. 'low', 'medium', 'high')\n- financial_awareness (text)\n- advice_style (text, e.g. 'gentle', 'direct', 'blunt')\n- nationality (text)\n- residency_status (text)\n- tax_residency_country (text)\n- years_in_country (number)",
        inputSchema: z.object({
          updates: z.array(
            z.object({
              field: z.string().describe('The user_profiles column name to update'),
              value: z.union([z.string(), z.number(), z.boolean()]).describe('The value to set'),
              confidence: z
                .number()
                .min(0)
                .max(1)
                .describe('Confidence level: 1.0 = explicit, 0.8 = strong implication, 0.6 = inference'),
            })
          ),
          source_summary: z.string().describe('Brief description of what the user said that led to these updates'),
        }),
        execute: async ({ updates, source_summary }) => {
          const saved: string[] = [];
          const skipped: string[] = [];

          // Check which fields were previously user-confirmed (via structured input)
          const { data: confirmedFields } = await supabase
            .from('profiling_queue')
            .select('field')
            .eq('user_id', user.id)
            .eq('source', 'structured_input')
            .eq('status', 'answered');

          const userConfirmedSet = new Set(
            (confirmedFields ?? []).map((f) => f.field)
          );

          for (const update of updates) {
            // Validate field name
            if (!ALLOWED_PROFILE_FIELDS.has(update.field)) {
              skipped.push(`${update.field} (invalid field)`);
              continue;
            }

            // Never overwrite user-confirmed values with inferred ones
            if (userConfirmedSet.has(update.field) && update.confidence < 1.0) {
              skipped.push(`${update.field} (already confirmed by user)`);
              continue;
            }

            // Apply confidence thresholds
            if (update.confidence < 0.6) {
              skipped.push(`${update.field} (low confidence — ask explicitly)`);
              continue;
            }

            // Save the update
            const updateData: Record<string, unknown> = {
              [update.field]: update.value,
              updated_at: new Date().toISOString(),
            };

            await supabase
              .from('user_profiles')
              .update(updateData)
              .eq('id', user.id);

            // Track in profiling queue
            await supabase.from('profiling_queue').upsert(
              {
                user_id: user.id,
                field: update.field,
                status: 'answered',
                answered_at: new Date().toISOString(),
                source: 'conversation',
                conversation_id: activeConversationId,
              },
              { onConflict: 'user_id,field' }
            );

            saved.push(update.field);
          }

          // Recalculate profile completeness
          if (saved.length > 0) {
            const { data: updatedProfile } = await supabase
              .from('user_profiles')
              .select('*')
              .eq('id', user.id)
              .single();

            if (updatedProfile) {
              const completeness = calculateProfileCompleteness(updatedProfile);
              await supabase
                .from('user_profiles')
                .update({ profile_completeness: completeness })
                .eq('id', user.id);
              revalidatePath('/', 'layout');
            }
          }

          const result: Record<string, unknown> = {
            saved,
            skipped,
            source: source_summary,
          };

          return result;
        },
      },

      // ── Channel A: Request structured input ──────────────────────────
      request_structured_input: {
        description:
          'Ask the user for a specific piece of information using an interactive input component rendered inline in the chat. Use this when you need precise data (numbers, selections, currency amounts) rather than free-text conversation. The component will appear in the chat. Always explain WHY you are asking before calling this tool.',
        inputSchema: z.object({
          field: z.string().describe('The user_profiles column to update with the response'),
          input_type: z
            .enum(['single_select', 'multi_select', 'currency_amount', 'number', 'text', 'slider'])
            .describe('The type of input component to render'),
          label: z.string().describe('The question/label shown above the input'),
          rationale: z.string().describe('Brief explanation shown to the user about why this is asked'),
          options: z
            .array(z.object({ value: z.string(), label: z.string() }))
            .optional()
            .describe('Options for single_select and multi_select types'),
          min: z.number().optional().describe('Minimum value for number/slider/currency inputs'),
          max: z.number().optional().describe('Maximum value for number/slider/currency inputs'),
          currency: z.boolean().optional().describe('Whether to show currency symbol for currency_amount type'),
          placeholder: z.string().optional().describe('Placeholder text for text/number inputs'),
          low_label: z.string().optional().describe('Label for the low end of a slider'),
          high_label: z.string().optional().describe('Label for the high end of a slider'),
        }),
        execute: async ({ field, input_type, label, rationale, options, min, max, currency, placeholder, low_label, high_label }) => {
          // Track that we asked this question
          await supabase.from('profiling_queue').upsert(
            {
              user_id: user.id,
              field,
              status: 'asked',
              asked_at: new Date().toISOString(),
              conversation_id: activeConversationId,
            },
            { onConflict: 'user_id,field' }
          );

          // Return the config for the frontend to render
          return {
            type: 'structured_input',
            field,
            input_type,
            label,
            rationale,
            options,
            min,
            max,
            currency,
            placeholder,
            low_label,
            high_label,
          };
        },
      },

      // ── CFO Toolbox (Session 7) ────────────────────────────────────
      ...toolbox,
    },
    toolChoice: 'auto',
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse({
    messageMetadata: ({ part }) => {
      if (part.type === 'finish' || part.type === 'start') {
        return { conversationId: activeConversationId, messageDbId: assistantMessageDbId };
      }
      return undefined;
    },
    onFinish: async ({ messages: responseMessages }) => {
      // Get token usage from the stream result
      const usage = await result.usage;
      // Save assistant response — get the last assistant message for text
      const assistantMsg = responseMessages
        .filter((m) => m.role === 'assistant')
        .pop();

      if (assistantMsg) {
        let textContent = extractTextFromParts(assistantMsg);

        // Extract tool metadata from ALL messages. In CoreMessage format
        // (what onFinish receives), tool calls live in assistant messages
        // as { type: 'tool-call', toolCallId, toolName, input } parts and
        // their results live in subsequent tool messages as
        // { type: 'tool-result', toolCallId, toolName, output } parts.
        // Match call→result by toolCallId so we only count tools that
        // actually completed.
        const toolsUsed: string[] = [];
        const actionsCreated: Array<{ id: string; title: string }> = [];
        const profileUpdates: Array<{ field: string }> = [];

        const toolCalls = new Map<string, string>(); // toolCallId → toolName
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolResults = new Map<string, any>(); // toolCallId → output

        for (const msg of responseMessages) {
          if (!msg.parts) continue;
          for (const part of msg.parts) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const anyPart = part as any;

            if (anyPart.type === 'tool-call' && anyPart.toolName && anyPart.toolCallId) {
              toolCalls.set(anyPart.toolCallId, anyPart.toolName);
            }
            if (anyPart.type === 'tool-result' && anyPart.toolCallId) {
              toolResults.set(anyPart.toolCallId, anyPart.output ?? anyPart.result);
            }
          }
        }

        for (const [callId, toolName] of toolCalls) {
          if (!toolResults.has(callId)) continue; // skip tools that didn't complete
          if (!toolsUsed.includes(toolName)) toolsUsed.push(toolName);

          const out = toolResults.get(callId);
          if (toolName === 'create_action_item' && out?.success && out?.action_item) {
            actionsCreated.push({
              id: out.action_item.id,
              title: out.action_item.title,
            });
          }
          if (toolName === 'update_user_profile' && out?.saved) {
            for (const field of out.saved) {
              profileUpdates.push({ field });
            }
          }
        }

        // ── Hallucination guard for record_value_classifications ─────────
        // Detect when the model says "saved/got it/etc." in a value-mapping
        // context but didn't actually call record_value_classifications,
        // then auto-retry with a forced tool call.
        const savedPhraseRegex =
          /\b(saved|got it|noted|will remember|i'?ll remember|added that|done)\b/i;
        const valueContextRegex = /\b(foundation|burden|investment|leak)\b/i;
        const lastUserText = extractTextFromParts(lastUserMessage) ?? '';

        const inValueContext =
          toolsUsed.includes('get_value_review_queue') ||
          valueContextRegex.test(textContent) ||
          valueContextRegex.test(lastUserText);

        const claimedSave = savedPhraseRegex.test(textContent);
        const actuallySaved = toolsUsed.includes('record_value_classifications');
        const hallucinated = inValueContext && claimedSave && !actuallySaved;

        if (hallucinated) {
          // Telemetry: log every detection regardless of whether retry succeeds
          void supabase.from('user_events').insert({
            profile_id: user.id,
            event_type: 'value_save_hallucination_detected',
            event_category: 'ai_quality',
            payload: {
              message_id: assistantMessageDbId,
              conversation_id: activeConversationId,
              assistant_text_excerpt: textContent.slice(0, 500),
              last_user_text_excerpt: lastUserText.slice(0, 500),
              tools_used: toolsUsed,
            },
          });

          // Forced retry: re-invoke the model with toolChoice locked to
          // record_value_classifications. The tool's execute() writes the
          // rule directly to the DB, so a successful call self-heals the
          // hallucination even though the user-visible streamed text has
          // already been delivered. Hard-cap at 1 retry.
          let retrySucceeded = false;
          try {
            const retryMessages = [
              ...modelMessages,
              { role: 'assistant' as const, content: textContent },
              {
                role: 'user' as const,
                content:
                  '[System] Your previous response said you saved the classification but you did not call record_value_classifications. Call it now with the correct arguments based on the conversation above. Do not output any text — only call the tool.',
              },
            ];

            // The retry only needs record_value_classifications. We pass the
            // CFO toolbox (which contains it, properly typed) and force the
            // model to call that specific tool.
            const retry = await generateText({
              model: chatModel,
              system: systemPrompt,
              messages: retryMessages,
              tools: toolbox,
              toolChoice: { type: 'tool', toolName: 'record_value_classifications' },
            });

            // generateText returns toolCalls/toolResults arrays; check that
            // the tool actually executed and the underlying applyValueClassification
            // succeeded (its return shape is { success: true, ... }).
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const retryResults: any[] = (retry as any).toolResults ?? [];
            const matched = retryResults.find(
              (r) => r?.toolName === 'record_value_classifications'
            );
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const out = matched?.output ?? matched?.result;
            if (out?.success) {
              retrySucceeded = true;
              if (!toolsUsed.includes('record_value_classifications')) {
                toolsUsed.push('record_value_classifications');
              }
              void supabase.from('user_events').insert({
                profile_id: user.id,
                event_type: 'value_save_hallucination_recovered',
                event_category: 'ai_quality',
                payload: {
                  message_id: assistantMessageDbId,
                  conversation_id: activeConversationId,
                  classified_count: out.classified_count ?? null,
                },
              });
            }
          } catch (err) {
            console.error('[chat] forced-retry generateText failed:', err);
          }

          if (!retrySucceeded) {
            // Safety net: append a clarifying line to the persisted message
            // so the user is never silently lied to.
            textContent +=
              '\n\n_(Note: I had trouble persisting that classification — please rephrase and try again.)_';
          }
        }
        // ── end hallucination guard ──────────────────────────────────────

        if (textContent) {
          await supabase.from('messages').insert({
            id: assistantMessageDbId,
            conversation_id: activeConversationId,
            user_id: user.id,
            role: 'assistant',
            content: textContent,
            tools_used: toolsUsed.length > 0 ? toolsUsed : null,
            actions_created: actionsCreated.length > 0 ? actionsCreated : null,
            profile_updates: profileUpdates.length > 0 ? profileUpdates : null,
            prompt_tokens: usage?.inputTokens ?? null,
            completion_tokens: usage?.outputTokens ?? null,
          });
        }
      }

      // Update conversation title from first visible exchange
      const userText = extractTextFromParts(lastUserMessage);
      const isSystemTrigger = userText?.startsWith('[System:');
      if (messages.length <= 1 && userText && !isSystemTrigger) {
        const title = userText.slice(0, 80);
        await supabase
          .from('conversations')
          .update({ title, updated_at: new Date().toISOString() })
          .eq('id', activeConversationId);
      } else {
        await supabase
          .from('conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', activeConversationId);
      }
    },
  });
  } catch (err: unknown) {
    console.error('[chat] unhandled error:', err);
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('ThrottlingException') || message.includes('Too many requests')) {
      return new Response('The AI service is temporarily busy. Please try again in a moment.', { status: 429 });
    }
    if (message.includes('TimeoutError') || message.includes('ETIMEDOUT') || message.includes('socket hang up')) {
      return new Response('The request timed out. Please try again.', { status: 504 });
    }
    if (message.includes('AccessDeniedException') || message.includes('UnauthorizedAccess')) {
      return new Response('AI service configuration error. Please contact support.', { status: 503 });
    }
    if (message.includes('ValidationException') || message.includes('ModelNotReadyException')) {
      return new Response('AI service temporarily unavailable. Please try again shortly.', { status: 503 });
    }
    return new Response('Something went wrong. Please try again.', { status: 500 });
  }
}

function extractTextFromParts(message: UIMessage): string {
  if (!message?.parts) return '';
  return message.parts
    .filter((p) => p.type === 'text')
    .map((p) => (p as { type: 'text'; text: string }).text)
    .join('');
}
