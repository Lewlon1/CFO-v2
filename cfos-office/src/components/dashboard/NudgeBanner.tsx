'use client';

import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { NUDGE_ICONS } from '@/lib/nudges/rules';

interface Nudge {
  id: string;
  type: string;
  title: string;
  body: string;
  action_url: string | null;
  status: string;
}

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function NudgeBanner() {
  const router = useRouter();
  const { data, mutate } = useSWR<{ nudges: Nudge[] }>(
    '/api/nudges?status=pending&limit=1',
    fetcher
  );

  const nudge = data?.nudges?.[0];
  if (!nudge) return null;

  const icon = NUDGE_ICONS[nudge.type as keyof typeof NUDGE_ICONS] ?? '🔔';

  const handleAction = async () => {
    await fetch('/api/nudges', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nudge_ids: [nudge.id], action: 'read' }),
    });
    mutate();
    if (nudge.action_url) {
      router.push(nudge.action_url);
    }
  };

  const handleDismiss = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch('/api/nudges', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nudge_ids: [nudge.id], action: 'dismissed' }),
    });
    mutate();
  };

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 mb-4 rounded-lg border border-primary/20 bg-primary/5 cursor-pointer hover:bg-primary/10 transition-colors"
      onClick={handleAction}
    >
      <span className="text-lg leading-none flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{nudge.title}</p>
      </div>
      <button
        className="flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center text-muted-foreground/50 hover:text-foreground transition-colors"
        onClick={handleDismiss}
        aria-label="Dismiss"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 3l8 8M11 3l-8 8" />
        </svg>
      </button>
    </div>
  );
}
