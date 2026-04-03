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

  // Build dynamic system prompt
  const systemPrompt = await buildSystemPrompt(user.id);

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

  // Save the user's latest message
  const lastUserMessage = messages[messages.length - 1];
  if (lastUserMessage?.role === 'user') {
    const textContent = extractTextFromParts(lastUserMessage);
    if (textContent) {
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
    },
    stopWhen: stepCountIs(3),
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

      // Update conversation title from first exchange
      const userText = extractTextFromParts(lastUserMessage);
      if (messages.length <= 1 && userText) {
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
