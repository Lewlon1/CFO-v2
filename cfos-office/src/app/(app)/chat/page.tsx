import { createClient } from '@/lib/supabase/server';
import { ChatInterface } from '@/components/chat/ChatInterface';
import { ChatErrorBoundary } from '@/components/chat/ChatErrorBoundary';
import { ConversationList } from '@/components/chat/ConversationList';

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const params = await searchParams;
  const nudgeType = typeof params.nudge === 'string' ? params.nudge : undefined;
  const nudgeCategory = typeof params.category === 'string' ? params.category : undefined;
  const nudgeProvider = typeof params.provider === 'string' ? params.provider : undefined;
  const conversationType = typeof params.type === 'string' ? params.type : undefined;
  const checkinDoneCount =
    typeof params.checkin_done === 'string' ? params.checkin_done : undefined;

  const [{ data: conversations }, { data: profile }, { count: transactionCount }] =
    await Promise.all([
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
      supabase
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user!.id),
    ]);

  const hasTransactions = (transactionCount ?? 0) > 0;

  // Mark originating nudge as read when arriving from a nudge
  if (nudgeType) {
    const { data: pendingNudge } = await supabase
      .from('nudges')
      .select('id')
      .eq('user_id', user!.id)
      .eq('type', nudgeType)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (pendingNudge) {
      await supabase
        .from('nudges')
        .update({ status: 'read', read_at: new Date().toISOString() })
        .eq('id', pendingNudge.id);
    }
  }

  // Build metadata for nudge-initiated or check-in-completion conversations
  const chatConversationType = nudgeType
    ? 'nudge_initiated'
    : checkinDoneCount
      ? 'value_checkin_done'
      : conversationType;
  let chatMetadata: Record<string, string> | undefined = undefined;
  if (nudgeType) {
    chatMetadata = { nudge_type: nudgeType };
    if (nudgeCategory) chatMetadata.category = nudgeCategory;
    if (nudgeProvider) chatMetadata.provider = nudgeProvider;
  } else if (checkinDoneCount) {
    chatMetadata = { checkin_count: checkinDoneCount };
  }

  return (
    <>
      {/* Desktop conversation sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r border-border bg-card flex-shrink-0">
        <ConversationList conversations={conversations ?? []} />
      </aside>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        <ChatErrorBoundary>
          <ChatInterface
            key={nudgeType ? `nudge-${nudgeType}` : checkinDoneCount ? `checkin-${checkinDoneCount}` : 'new'}
            initialConversationId={null}
            conversationType={chatConversationType}
            conversationMetadata={chatMetadata}
            userCurrency={profile?.primary_currency ?? undefined}
            conversations={conversations ?? []}
            hasTransactions={hasTransactions}
          />
        </ChatErrorBoundary>
      </div>
    </>
  );
}
