import { streamText, generateText, convertToModelMessages, UIMessage, stepCountIs } from 'ai';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
// GDPR: This route runs in eu-west-1 (Dublin) via Vercel function region config.
// Bedrock calls use the EU inference profile (eu. prefix) to keep data in EU.
// Supabase is also in eu-west-1. No user data leaves EU infrastructure.
import { chatModel } from '@/lib/ai/provider';
import { logBedrockUsage } from '@/lib/ai/usage-logger';
import { logToolCall } from '@/lib/observability/llm-usage-log';
import { buildSystemPrompt } from '@/lib/ai/context-builder';
import { createClient } from '@/lib/supabase/server';
import { calculateProfileCompleteness } from '@/lib/profiling/engine';
import { createToolbox, type ToolContext } from '@/lib/ai/tools';
import { sendAlert, wrapToolsWithAlerts } from '@/lib/alerts/notify';
import { extractMessageAudit } from '@/lib/ai/audit-trail';
import { markOnboardingCompleteIfReady } from '@/lib/onboarding/markComplete';
import { extractFromConversation } from '@/lib/ai/portrait-extraction';
import { extractProfileFields } from '@/lib/ai/profile-extraction';
import { createServiceClient } from '@/lib/supabase/service';
import { classifyValueMapDecline } from '@/lib/onboarding-v2/value-map-decline-classifier';
import { quickClassifyDecline } from '@/lib/onboarding-v2/value-map-decline-quickcheck';
import { hasStartValueMapAction, stripActionMarkers } from '@/lib/onboarding-v2/bridge';
import { isChatIntelligenceV2Enabled } from '@/lib/features/chat-intelligence-v2';
import {
  buildCitationAllowlist,
  validateCitations,
  validateProjections,
  validateVoice,
  validateChips,
  validateLength,
  appendCorrection,
  type ToolResultLike,
} from '@/lib/ai/insight-validator';
import { extractChips, removeInvalidChips } from '@/lib/chat/options-parser';
import { sanitisePersona } from '@/lib/ai/persona-sanitiser';
import { isLayeredReadEnabled } from '@/lib/feature-flags/layered-read';
import { extractAndStoreSignals } from '@/lib/analytics/chat-signals';
import { VCR_ON_CONFLICT } from '@/lib/prediction/types';

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
    conversationMetadata?: Record<string, unknown>;
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
  let conversationMetadata: Record<string, unknown> | null = null;
  if (conversationId) {
    const { data: conv } = await supabase
      .from('conversations')
      .select('type, metadata')
      .eq('id', conversationId)
      .eq('user_id', user.id)
      .single();
    if (conv) {
      conversationType = conv.type ?? undefined;
      // metadata is Json | null in the schema; narrow to a plain record so the
      // downstream prompt builders can index keys without re-asserting.
      conversationMetadata =
        conv.metadata && typeof conv.metadata === 'object' && !Array.isArray(conv.metadata)
          ? (conv.metadata as Record<string, unknown>)
          : null;
    }
  } else if (requestedType) {
    // New conversation with a specific type (e.g. trip_planning, scenario)
    conversationType = requestedType;
    conversationMetadata = requestedMetadata ?? null;
  }

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

    // Post-conversation portrait extraction for any conversations we just
    // marked completed. Wrapped in `after()` so the work survives past the
    // streaming response (a bare `fetch().catch()` here was killed by Vercel
    // before landing — see S-W1.5-11). On failure, `analysed_at` stays NULL
    // and the daily cron at /api/cron/portrait-extraction picks it up.
    if (completedConvs && completedConvs.length > 0) {
      for (const conv of completedConvs) {
        after(async () => {
          try {
            // Use a fresh service-role client inside `after()` so the work
            // doesn't depend on the request's auth cookies still being valid
            // and isn't gated by RLS on `financial_portrait` / `profiling_queue`.
            const serviceSupabase = createServiceClient();
            await extractFromConversation(serviceSupabase, {
              conversationId: conv.id,
              userId: user.id,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[chat] post-conversation extraction failed:', message);
            await sendAlert({
              severity: 'critical',
              event: 'portrait_extraction_after_failed',
              user_id: user.id,
              details: message,
              metadata: { conversationId: conv.id, callSite: 'chat_route' },
            }).catch(() => {});
          }
        });

        // Profile-field extraction runs alongside the portrait extractor in a
        // separate `after()` so a failure in one doesn't block the other. The
        // daily cron at /api/cron/profile-extraction catches anything missed.
        after(async () => {
          try {
            const serviceSupabase = createServiceClient();
            await extractProfileFields(serviceSupabase, {
              conversationId: conv.id,
              userId: user.id,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[chat] post-conversation profile extraction failed:', message);
            await sendAlert({
              severity: 'critical',
              event: 'profile_extraction_after_failed',
              user_id: user.id,
              details: message,
              metadata: { conversationId: conv.id, callSite: 'chat_route' },
            }).catch(() => {});
          }
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
      const { data: insertedMessage } = await supabase
        .from('messages')
        .insert({
          conversation_id: activeConversationId,
          user_id: user.id,
          role: 'user',
          content: textContent,
        })
        .select('id')
        .single();

      // Permissive onboarding completion — fire-and-forget. Helper itself
      // enforces the >=3 user-message threshold; no pre-count needed here.
      markOnboardingCompleteIfReady(supabase, user.id).catch((err) => {
        console.error('[chat] markOnboardingCompleteIfReady failed:', err);
      });

      // Session 32 (A) — Layer 4: extract conversational signals from this
      // message and store in chat_signals. Fire-and-forget via after().
      // Pattern matching is cheap; LLM fallback (Haiku) only fires when patterns
      // miss or are low-confidence. Failures are swallowed.
      if (isLayeredReadEnabled() && insertedMessage?.id) {
        const persistedMessageId = insertedMessage.id as string;
        after(async () => {
          try {
            // Recent merchants for attribution context (top N from last 30 days).
            const serviceClient = createServiceClient();
            const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
            const { data: topMerchants } = await serviceClient
              .from('transactions')
              .select('description')
              .eq('user_id', user.id)
              .is('deleted_at', null)
              .gte('date', thirtyDaysAgo)
              .not('description', 'is', null)
              .limit(50);
            const merchantSet = new Set<string>();
            for (const row of (topMerchants ?? []) as Array<{ description: string }>) {
              if (row.description) merchantSet.add(row.description);
              if (merchantSet.size >= 10) break;
            }
            await extractAndStoreSignals({
              userId: user.id,
              messageId: persistedMessageId,
              messageText: textContent,
              recentMerchants: Array.from(merchantSet),
            });
          } catch (err) {
            console.error('[chat] chat-signals extraction failed:', err);
          }
        });
      }
    }
  }

  // Fetch user profile (currency for tool context + onboarding-v2 bridge state).
  // beta_cohort + net_monthly_income + monthly_rent feed the v2 chat-intel
  // validators (Phase 6) — kept in the same query to avoid an extra round-trip.
  // onboarding_step + onboarding_progress feed the goal-chat stall handler.
  const { data: profileForChat } = await supabase
    .from('user_profiles')
    .select(
      'primary_currency, onboarding_route, value_map_offered_in_chat, value_map_declined_in_chat, beta_cohort, net_monthly_income, monthly_rent, onboarding_step, onboarding_progress',
    )
    .eq('id', user.id)
    .single();

  // Goal-chat stall handler. The prompt-side "draft on next turn" rule is the
  // primary mechanism; this is a safety net for the case where the model
  // doesn't comply. After 5 user turns in `onboarding_goal_chat` without an
  // active goal, the onboarding state advances to `goal_chat_tentative` and a
  // transient system note tells the CFO to pivot to the essentials (income +
  // rent). The user can set a specific goal later — tentative state is a
  // feature, not a failure mode.
  let stallSystemNote: string | null = null;
  if (
    conversationType === 'onboarding_goal_chat' &&
    profileForChat?.onboarding_step === 'goal_chat_started'
  ) {
    const [{ count: userTurnCount }, { count: goalCount }] = await Promise.all([
      supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', activeConversationId)
        .eq('role', 'user'),
      supabase
        .from('goals')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .is('deleted_at', null),
    ]);

    // The user message for THIS turn is already persisted above (L203),
    // so userTurnCount reflects the count including the current turn.
    if ((userTurnCount ?? 0) >= 5 && (goalCount ?? 0) === 0) {
      const existingProgress =
        profileForChat.onboarding_progress && typeof profileForChat.onboarding_progress === 'object'
          ? (profileForChat.onboarding_progress as Record<string, unknown>)
          : {};
      await supabase
        .from('user_profiles')
        .update({
          onboarding_step: 'goal_chat_tentative',
          onboarding_progress: {
            ...existingProgress,
            goal_chat_tentative_at: new Date().toISOString(),
          },
        })
        .eq('id', user.id);

      stallSystemNote =
        '[SYSTEM] The user has exchanged 5+ turns without committing to a goal. ' +
        'Acknowledge that there is enough context for now and pivot to the essentials. ' +
        'Do NOT ask another goal-related question. ' +
        'In your next response, call request_structured_input for net_monthly_income ' +
        '(input_type="currency_amount", label="What\'s your monthly take-home pay?", ' +
        'rationale="So I can pace anything against what you actually have to work with.").';
    }
  }

  // Onboarding v2 — Value Map decline classifier.
  // Regex fast-path handles the common decline/accept phrases without a
  // Bedrock round-trip; Haiku is only called for ambiguous text. Keeps the
  // assistant stream from blocking on a ~500-1500ms Haiku call for the 95%
  // case while preserving semantic accuracy on edge cases.
  if (
    profileForChat?.onboarding_route === 'chat' &&
    profileForChat?.value_map_offered_in_chat === true &&
    profileForChat?.value_map_declined_in_chat === false &&
    lastUserMessage?.role === 'user'
  ) {
    const lastUserText = extractTextFromParts(lastUserMessage);
    if (lastUserText && !lastUserText.startsWith('[System:')) {
      const quick = quickClassifyDecline(lastUserText);
      let declined: boolean;
      if (quick === 'declined') {
        declined = true;
      } else if (quick === 'accepted') {
        declined = false;
      } else {
        declined = await classifyValueMapDecline(lastUserText, user.id);
      }
      if (declined) {
        await supabase
          .from('user_profiles')
          .update({ value_map_declined_in_chat: true })
          .eq('id', user.id);
        // Reflect locally so the system prompt below sees the new state.
        profileForChat.value_map_declined_in_chat = true;
      }
    }
  }

  // Build dynamic system prompt — after activeConversationId is known AND
  // after the decline classifier has potentially flipped the declined flag,
  // so the bridge context section reflects current state.
  const baseSystemPrompt = await buildSystemPrompt(
    user.id,
    conversationType,
    conversationMetadata,
    activeConversationId,
  );

  const systemPrompt = stallSystemNote
    ? `${baseSystemPrompt}\n\n---\n\n${stallSystemNote}`
    : baseSystemPrompt;

  const toolCtx: ToolContext = {
    supabase,
    userId: user.id,
    conversationId: activeConversationId!,
    currency: profileForChat?.primary_currency || 'EUR',
  };

  const toolbox = wrapToolsWithAlerts(createToolbox(toolCtx), user.id);

  // Convert UI messages to model format
  const modelMessages = await convertToModelMessages(messages);

  // Pre-generate DB ID for the assistant message so we can stream it to the client
  const assistantMessageDbId = crypto.randomUUID();

  // Stream response
  //
  // The system prompt is passed as a system-role message (rather than the
  // top-level `system:` param) so we can attach a Bedrock cache point to it
  // via providerOptions. First turn of a conversation writes the cache
  // (~1.25x input cost for the cached segment); subsequent turns within the
  // 5-minute TTL read from cache (~0.1x).
  const result = streamText({
    model: chatModel,
    messages: [
      {
        role: 'system',
        content: systemPrompt,
        providerOptions: {
          bedrock: { cachePoint: { type: 'default' } },
        },
      },
      ...modelMessages,
    ],
    tools: {
      get_current_date: {
        description:
          'Get today\'s date and time.',
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
          'Update how a spending category is classified when the user tells you it should be different (e.g. "dining is an investment for me, not a leak").',
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
                match_type: 'category' as const,
                match_value: category_slug,
                value_category,
                confidence: 1.0,
                source: 'correction',
                last_signal_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
              { onConflict: VCR_ON_CONFLICT },
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

          let affectedCount = 0;
          if (category) {
            const { count } = await supabase
              .from('transactions')
              .update({ value_category }, { count: 'exact' })
              .eq('user_id', user.id)
              .eq('category_id', category_slug)
              .eq('user_confirmed', false);
            affectedCount = count ?? 0;
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
            category_slug,
            value_category,
            affected_transactions: affectedCount,
            message: `Updated ${category_slug} to "${value_category}". Your transactions have been updated to reflect this.`,
          };
        },
      },

      // ── Channel B: Update user profile from conversation ─────────────
      update_user_profile: {
        description:
          "Save what the user told you about themselves. Do NOT ask 'should I save this?' first — a confirmation card appears in chat showing exactly what was saved, with Undo available to the user. Only pause to clarify when the meaning is genuinely ambiguous. Set confidence to 1.0 for explicit statements, 0.8 for strong implications. Confidence below 0.6 will be skipped server-side.\n\nValid field names and expected types:\n- display_name (text)\n- country (text, e.g. 'Spain')\n- city (text)\n- primary_currency (text, e.g. 'EUR')\n- age_range (text, e.g. '31-35')\n- employment_status (text, e.g. 'employed', 'self_employed', 'freelance')\n- gross_salary (number, annual)\n- net_monthly_income (number, monthly take-home)\n- pay_frequency (text, e.g. 'monthly', 'monthly_with_extra_payments')\n- has_bonus_months (boolean)\n- bonus_month_details (text)\n- housing_type (text, e.g. 'renting', 'owned')\n- monthly_rent (number, monthly rent or mortgage payment)\n- relationship_status (text, e.g. 'single', 'partnered', 'married')\n- partner_employment_status (text)\n- partner_monthly_contribution (number)\n- dependents (number, count of dependents)\n- values_ranking (text)\n- spending_triggers (text)\n- risk_tolerance (text, e.g. 'low', 'medium', 'high')\n- financial_awareness (text)\n- advice_style (text, e.g. 'gentle', 'direct', 'blunt')\n- nationality (text)\n- residency_status (text)\n- tax_residency_country (text)\n- years_in_country (number)",
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
          const before_values: Record<string, unknown> = {};
          const saved_values: Record<string, unknown> = {};

          // Snapshot the current profile row so we can capture previous values per field
          const { data: previousProfile } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('id', user.id)
            .maybeSingle();

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

            before_values[update.field] =
              (previousProfile as Record<string, unknown> | null)?.[update.field] ?? null;
            saved_values[update.field] = update.value;
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
            before_values,
            saved_values,
          };

          return result;
        },
      },

      // ── Channel A: Request structured input ──────────────────────────
      request_structured_input: {
        description:
          'Show an input form when you need a specific number or choice from the user. The component appears inline in chat. Always explain WHY before calling this.',
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
    onStepFinish: ({ toolCalls, usage }) => {
      if (!toolCalls || toolCalls.length === 0) return;
      const toolsInStep = toolCalls.length;
      for (const call of toolCalls) {
        void logToolCall({
          userId: user.id,
          toolName: call.toolName,
          model: 'claude-sonnet-4-6',
          conversationId: activeConversationId,
          messageId: assistantMessageDbId,
          stepInputTokens: usage?.inputTokens,
          stepOutputTokens: usage?.outputTokens,
          toolsInStep,
        });
      }
    },
  });

  return result.toUIMessageStreamResponse({
    messageMetadata: ({ part }) => {
      if (part.type === 'finish' || part.type === 'start') {
        return { conversationId: activeConversationId, messageDbId: assistantMessageDbId };
      }
      return undefined;
    },
    onFinish: async ({ messages: responseMessages }) => {
      // Get token usage + provider metadata from the stream result
      const usage = await result.usage;
      const providerMetadata = await result.providerMetadata;
      const bedrockMeta = (providerMetadata?.bedrock ?? {}) as {
        usage?: { cacheWriteInputTokens?: number };
      };
      const cacheReadTokens = usage?.inputTokenDetails?.cacheReadTokens;
      const cacheWriteTokens =
        usage?.inputTokenDetails?.cacheWriteTokens ?? bedrockMeta.usage?.cacheWriteInputTokens;

      logBedrockUsage({
        callSite: 'chat',
        model: 'sonnet',
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        cacheCreationTokens: cacheWriteTokens,
        cacheReadTokens,
        userId: user.id,
        conversationId: activeConversationId ?? undefined,
        timestamp: new Date().toISOString(),
      });
      // Save assistant response — get the last assistant message for text
      const assistantMsg = responseMessages
        .filter((m) => m.role === 'assistant')
        .pop();

      if (assistantMsg) {
        let textContent = extractTextFromParts(assistantMsg);

        // Extract tool metadata. AI SDK v6 represents UIMessage tool parts as
        // { type: `tool-${toolName}`, state: 'output-available', output: ... }.
        // The hallucination guard below mutates `toolsUsed` in place when a
        // forced retry of record_value_classifications recovers — that's why
        // the const destructure is fine (we never reassign the variable, only
        // .push() onto the array).
        const { toolsUsed, profileUpdates, actionsCreated, insightsGenerated } =
          extractMessageAudit(responseMessages);

        // Onboarding v2 — Value Map action emission.
        // The system prompt instructs the model to include a literal
        // `<ACTION:start_value_map>` token when offering the Value Map. We
        // strip the marker from the displayed text and persist a structured
        // action so the chat UI can render an inline button.
        if (textContent && hasStartValueMapAction(textContent)) {
          textContent = stripActionMarkers(textContent);
          actionsCreated.push({ type: 'start_value_map' });
          // Flip the offered-in-chat ratchet (idempotent on conflict).
          await supabase
            .from('user_profiles')
            .update({ value_map_offered_in_chat: true })
            .eq('id', user.id)
            .eq('value_map_offered_in_chat', false);
        }

        // Server-side fallback: if create_goal fired inside the goal-derive
        // beat and the LLM didn't emit the <ACTION:start_value_map> token,
        // inject the action so the chip renders. The chip is the universal
        // exit from the goal beat — losing it strands the user (the watcher
        // no longer force-redirects Marcus, so the chip is the only handoff).
        if (
          conversationType === 'onboarding_goal_chat' &&
          toolsUsed.includes('create_goal') &&
          !actionsCreated.some(
            (a) => (a as { type?: string }).type === 'start_value_map',
          )
        ) {
          actionsCreated.push({ type: 'start_value_map' });
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
              '\n\n_(Note: that classification didn\'t persist — rephrase and try again.)_';
          }
        }
        // ── end hallucination guard ──────────────────────────────────────

        // ── V2 chat-intelligence validators (Phase 6) ────────────────────
        // For wave-1/wave-1.5 cohort users on first_insight conversations,
        // run four deterministic guards on the LLM output:
        //   - citation grounding (numbers + merchants → tool result/brief)
        //   - projection grounding (any /year, /month, "saved" framing →
        //     propose_experiment tool result)
        //   - voice (banned reflexive CFO phrases)
        //   - chip validity (no generic / navigation / no-narrative-noun)
        //
        // When the first three fire, a short server-side correction is
        // appended to the persisted message body and a single user_events
        // row is logged. Bad chips are stripped from the [OPTIONS] block.
        const v2Enabled = isChatIntelligenceV2Enabled(profileForChat);
        if (
          v2Enabled &&
          conversationType === 'first_insight' &&
          textContent
        ) {
          // Build the ToolResultLike[] from the audit trail. insightsGenerated
          // already carries { tool, output } for every successful structured
          // tool call, which is exactly the shape buildCitationAllowlist wants.
          const toolResults: ToolResultLike[] = insightsGenerated.map((entry) => ({
            toolName: entry.tool,
            output: entry.output,
          }));

          // Brief facts: income + rent are enough to ground common numbers
          // the LLM might quote without a tool call (e.g. "your £2,800 net").
          const brief = {
            income: profileForChat?.net_monthly_income ?? null,
            rent: profileForChat?.monthly_rent ?? null,
          };

          const allowlist = buildCitationAllowlist(toolResults, brief);
          const citationCheck = validateCitations(textContent, allowlist);

          // Filter toolResults down to propose_experiment outputs for the
          // projection validator. Each output has the shape
          // { monthly_impact: { amount }, annualised_impact: { amount }, ... }.
          const experimentResults = toolResults
            .filter((r) => r.toolName === 'propose_experiment')
            .map((r) => r.output as {
              monthly_impact?: { amount?: number };
              annualised_impact?: { amount?: number };
            });
          const projectionCheck = validateProjections(textContent, experimentResults);

          const voiceCheck = validateVoice(textContent);
          const lengthCheck = validateLength(textContent);

          if (
            !citationCheck.valid ||
            !projectionCheck.valid ||
            !voiceCheck.valid ||
            !lengthCheck.valid
          ) {
            textContent = appendCorrection(textContent, {
              unmatched_citations: citationCheck.unmatched,
              unmatched_projections: projectionCheck.unmatched_projections,
              voice_violations: voiceCheck.violations,
              length_violation: lengthCheck.valid ? undefined : lengthCheck,
            });

            void supabase.from('user_events').insert({
              profile_id: user.id,
              session_id: activeConversationId,
              event_type: 'first_insight_validator_fired',
              event_category: 'validation',
              payload: {
                message_id: assistantMessageDbId,
                citationCheck,
                projectionCheck,
                voiceCheck,
                lengthCheck,
              },
            });
          }

          // Chip validation runs AFTER the citation/projection/voice append,
          // because the appended correction can affect chip-narrative-noun
          // matching (it shouldn't — the appended text is meta — but
          // running it last keeps the chip check focused on chips alone).
          const chips = extractChips(textContent);
          if (chips.length > 0) {
            const chipCheck = validateChips(chips, textContent);
            if (!chipCheck.valid) {
              const invalid = chips.filter((c) => chipCheck.reasons[c]);
              if (invalid.length > 0) {
                textContent = removeInvalidChips(textContent, invalid);
                void supabase.from('user_events').insert({
                  profile_id: user.id,
                  session_id: activeConversationId,
                  event_type: 'first_insight_chips_stripped',
                  event_category: 'validation',
                  payload: {
                    message_id: assistantMessageDbId,
                    invalid_chips: invalid,
                    reasons: chipCheck.reasons,
                  },
                });
              }
            }
          }
        }
        // ── end v2 chat-intelligence validators ───────────────────────────

        if (textContent) {
          // ── Persona-leak sanitiser ────────────────────────────────────
          // Strip first-person drift before the message hits the DB. Clean
          // messages cost nothing (regex only). Dirty messages get a Haiku
          // rewrite; the historical record stays clean for the prompt cache.
          const originalText = textContent;
          const sanitised = await sanitisePersona(textContent);
          textContent = sanitised.text;

          await supabase.from('messages').insert({
            id: assistantMessageDbId,
            conversation_id: activeConversationId,
            user_id: user.id,
            role: 'assistant',
            content: textContent,
            tools_used: toolsUsed.length > 0 ? toolsUsed : null,
            actions_created: actionsCreated.length > 0 ? actionsCreated : null,
            profile_updates: profileUpdates.length > 0 ? profileUpdates : null,
            insights_generated: insightsGenerated.length > 0 ? insightsGenerated : null,
            prompt_tokens: usage?.inputTokens ?? null,
            completion_tokens: usage?.outputTokens ?? null,
          });

          if (sanitised.rewritten && activeConversationId) {
            await supabase
              .from('persona_sanitiser_log')
              .insert({
                user_id: user.id,
                conversation_id: activeConversationId,
                message_id: assistantMessageDbId,
                leaks_detected: sanitised.leaks_detected,
                original_text: originalText,
                rewritten_text: textContent,
              })
              .then(({ error }) => {
                if (error) console.error('[persona-sanitiser] log insert failed', error);
              });
          }
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

    sendAlert({
      severity: 'critical',
      event: 'bedrock_chat_error',
      details: `Chat API error: ${message.slice(0, 200)}`,
    }).catch(() => {});

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
