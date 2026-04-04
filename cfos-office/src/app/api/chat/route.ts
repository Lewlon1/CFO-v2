import { streamText, convertToModelMessages, UIMessage, stepCountIs } from 'ai';
import { z } from 'zod';
import { chatModel } from '@/lib/ai/provider';
import { buildSystemPrompt } from '@/lib/ai/context-builder';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { messages, conversationId } = (await req.json()) as {
    messages: UIMessage[];
    conversationId: string | null;
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
  }

  // Build dynamic system prompt
  const systemPrompt = await buildSystemPrompt(user.id, conversationType, conversationMetadata);

  // Create or reuse conversation
  let activeConversationId = conversationId;
  if (!activeConversationId) {
    const { data, error } = await supabase
      .from('conversations')
      .insert({ user_id: user.id, title: 'New conversation', type: 'general' })
      .select('id')
      .single();

    if (error || !data) {
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
    },
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
      // Save assistant response — get the last assistant message
      const assistantMsg = responseMessages
        .filter((m) => m.role === 'assistant')
        .pop();

      if (assistantMsg) {
        const textContent = extractTextFromParts(assistantMsg);
        if (textContent) {
          await supabase.from('messages').insert({
            conversation_id: activeConversationId,
            role: 'assistant',
            content: textContent,
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
}

function extractTextFromParts(message: UIMessage): string {
  if (!message?.parts) return '';
  return message.parts
    .filter((p) => p.type === 'text')
    .map((p) => (p as { type: 'text'; text: string }).text)
    .join('');
}
