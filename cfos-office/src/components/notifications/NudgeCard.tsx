'use client';

import { useRouter } from 'next/navigation';
import { NUDGE_ICONS } from '@/lib/nudges/rules';

interface Nudge {
  id: string;
  type: string;
  title: string;
  body: string;
  action_url: string | null;
  status: string;
  created_at: string;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function NudgeCard({
  nudge,
  onDismiss,
  onTap,
}: {
  nudge: Nudge;
  onDismiss: (id: string) => void;
  onTap: (nudge: Nudge) => void;
}) {
  const router = useRouter();
  const icon = NUDGE_ICONS[nudge.type as keyof typeof NUDGE_ICONS] ?? '🔔';
  const isUnread = nudge.status === 'pending';

  const handleTap = () => {
    onTap(nudge);
    if (nudge.action_url) {
      router.push(nudge.action_url);
    }
  };

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-accent/50 ${
        isUnread ? 'bg-accent/20' : ''
      }`}
      onClick={handleTap}
    >
      <span className="text-lg leading-none mt-0.5 flex-shrink-0">{icon}</span>

      <div className="flex-1 min-w-0">
        <p
          className={`text-sm leading-snug ${
            isUnread ? 'font-medium text-foreground' : 'text-muted-foreground'
          }`}
        >
          {nudge.title}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{nudge.body}</p>
        <p className="text-[10px] text-muted-foreground/60 mt-1">{timeAgo(nudge.created_at)}</p>
      </div>

      <button
        className="flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center text-muted-foreground/50 hover:text-foreground transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(nudge.id);
        }}
        aria-label="Dismiss notification"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 3l8 8M11 3l-8 8" />
        </svg>
      </button>
    </div>
  );
}
