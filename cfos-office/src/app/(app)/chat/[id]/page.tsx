import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ChatInterface } from '@/components/chat/ChatInterface';
import { ConversationList } from '@/components/chat/ConversationList';
import { UIMessage } from 'ai';

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch this conversation (RLS ensures ownership)
  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, title, type')
    .eq('id', id)
    .single();

  if (!conversation) {
    redirect('/chat');
  }

  // Fetch messages for this conversation
  const { data: dbMessages } = await supabase
    .from('messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true });

  // Convert DB messages to UIMessage format
  const initialMessages: UIMessage[] = (dbMessages ?? []).map((msg) => ({
    id: msg.id,
    role: msg.role as 'user' | 'assistant',
    parts: [{ type: 'text' as const, text: msg.content }],
    createdAt: new Date(msg.created_at),
  }));

  // Fetch all conversations for sidebar + user currency
  const [{ data: conversations }, { data: profile }] = await Promise.all([
    supabase
      .from('conversations')
      .select('id, title, updated_at')
      .eq('user_id', user!.id)
      .order('updated_at', { ascending: false }),
    supabase
      .from('user_profiles')
      .select('primary_currency')
      .eq('id', user!.id)
      .single(),
  ]);

  return (
    <>
      {/* Desktop conversation sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r border-border bg-card flex-shrink-0">
        <ConversationList conversations={conversations ?? []} />
      </aside>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        <ChatInterface
          key={conversation.id}
          initialConversationId={conversation.id}
          initialMessages={initialMessages}
          conversationType={conversation.type ?? undefined}
          userCurrency={profile?.primary_currency ?? undefined}
        />
      </div>
    </>
  );
}
