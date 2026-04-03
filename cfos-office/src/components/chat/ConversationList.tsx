'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Conversation {
  id: string;
  title: string | null;
  updated_at: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function ConversationList({
  conversations,
}: {
  conversations: Conversation[];
}) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-3 border-b border-border">
        <Link
          href="/chat"
          className="flex items-center justify-center gap-2 w-full px-3 py-2.5 text-sm font-medium text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New conversation
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {conversations.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8 px-4">
            No conversations yet. Start a new one!
          </p>
        )}
        {conversations.map((conv) => {
          const isActive = pathname === `/chat/${conv.id}`;
          return (
            <Link
              key={conv.id}
              href={`/chat/${conv.id}`}
              className={`block px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              }`}
            >
              <p className="truncate font-medium">
                {conv.title || 'New conversation'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {timeAgo(conv.updated_at)}
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
