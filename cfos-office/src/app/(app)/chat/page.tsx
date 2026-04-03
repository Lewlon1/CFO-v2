import { createClient } from '@/lib/supabase/server';
import { ChatInterface } from '@/components/chat/ChatInterface';
import { ConversationList } from '@/components/chat/ConversationList';

export default async function ChatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: conversations } = await supabase
    .from('conversations')
    .select('id, title, updated_at')
    .eq('user_id', user!.id)
    .order('updated_at', { ascending: false });

  return (
    <>
      {/* Desktop conversation sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r border-border bg-card flex-shrink-0">
        <ConversationList conversations={conversations ?? []} />
      </aside>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        <ChatInterface initialConversationId={null} />
      </div>
    </>
  );
}
