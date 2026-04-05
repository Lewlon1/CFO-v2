import { streamText, convertToModelMessages, UIMessage, stepCountIs } from 'ai';
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

  const { messages, conversationId, conversationType: requestedType, conversationMetadata: requestedMetadata } = (await req.json()) as {
    messages: UIMessage[];
    conversationId: string | null;
    conversationType?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conversationMetadata?: Record<string, any>;
  };

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
        return { conversationId: activeConversationId };
      }
      return undefined;
    },
    onFinish: async ({ messages: responseMessages }) => {
      // Save assistant response — get the last assistant message for text
      const assistantMsg = responseMessages
        .filter((m) => m.role === 'assistant')
        .pop();

      if (assistantMsg) {
        const textContent = extractTextFromParts(assistantMsg);

        // Extract tool metadata from ALL messages (tool invocations are in
        // earlier assistant messages, not the final text response)
        const toolsUsed: string[] = [];
        const actionsCreated: Array<{ id: string; title: string }> = [];
        const profileUpdates: Array<{ field: string }> = [];

        for (const msg of responseMessages) {
          if (!msg.parts) continue;
          for (const part of msg.parts) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const anyPart = part as any;

            if (anyPart.type === 'tool-invocation' && anyPart.toolName) {
              const toolName = anyPart.toolName as string;

              // Only count tools that have completed with results
              if (anyPart.result !== undefined) {
                if (!toolsUsed.includes(toolName)) {
                  toolsUsed.push(toolName);
                }

                const result = anyPart.result;
                if (toolName === 'create_action_item' && result?.success && result?.action_item) {
                  actionsCreated.push({
                    id: result.action_item.id,
                    title: result.action_item.title,
                  });
                }
                if (toolName === 'update_user_profile' && result?.saved) {
                  for (const field of result.saved) {
                    profileUpdates.push({ field });
                  }
                }
              }
            }
          }
        }

        if (textContent) {
          await supabase.from('messages').insert({
            conversation_id: activeConversationId,
            role: 'assistant',
            content: textContent,
            tools_used: toolsUsed.length > 0 ? toolsUsed : null,
            actions_created: actionsCreated.length > 0 ? actionsCreated : null,
            profile_updates: profileUpdates.length > 0 ? profileUpdates : null,
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
  } catch (err) {
    console.error('[chat] unhandled error:', err);
    return new Response(String(err), { status: 500 });
  }
}

function extractTextFromParts(message: UIMessage): string {
  if (!message?.parts) return '';
  return message.parts
    .filter((p) => p.type === 'text')
    .map((p) => (p as { type: 'text'; text: string }).text)
    .join('');
}
