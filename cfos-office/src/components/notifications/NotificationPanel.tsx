'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { NudgeCard } from './NudgeCard';

interface Nudge {
  id: string;
  type: string;
  title: string;
  body: string;
  action_url: string | null;
  status: string;
  created_at: string;
}

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function NotificationPanel({
  onClose,
  onCountChange,
}: {
  onClose: () => void;
  onCountChange: () => void;
}) {
  const { data, mutate } = useSWR<{ nudges: Nudge[]; unread_count: number }>(
    '/api/nudges',
    fetcher
  );

  const nudges = data?.nudges ?? [];

  const updateNudgeStatus = useCallback(
    async (nudgeIds: string[], action: 'read' | 'dismissed') => {
      await fetch('/api/nudges', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nudge_ids: nudgeIds, action }),
      });
      mutate();
      onCountChange();
    },
    [mutate, onCountChange]
  );

  const handleTap = useCallback(
    (nudge: Nudge) => {
      if (nudge.status === 'pending') {
        updateNudgeStatus([nudge.id], 'read');
      }
      onClose();
    },
    [updateNudgeStatus, onClose]
  );

  const handleDismiss = useCallback(
    (id: string) => {
      updateNudgeStatus([id], 'dismissed');
    },
    [updateNudgeStatus]
  );

  const handleMarkAllRead = useCallback(() => {
    const unreadIds = nudges.filter(n => n.status === 'pending').map(n => n.id);
    if (unreadIds.length > 0) {
      updateNudgeStatus(unreadIds, 'read');
    }
  }, [nudges, updateNudgeStatus]);

  const unreadCount = nudges.filter(n => n.status === 'pending').length;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/*
        Mobile  → full-width bottom sheet (fixed, bottom-0)
        Desktop → panel anchored just past the sidebar (w-56 = 14rem)
                  and below the sidebar header (~80px)
      */}
      <div className={[
        // shared
        'fixed z-50',
        // mobile: bottom sheet
        'inset-x-0 bottom-0',
        // desktop: dropdown to right of sidebar
        'md:inset-auto md:left-[calc(14rem+8px)] md:top-20 md:w-[360px]',
      ].join(' ')}>
        <div className="bg-card border border-border rounded-t-2xl md:rounded-xl shadow-2xl max-h-[80dvh] md:max-h-[420px] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
            <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  className="text-xs text-primary hover:text-primary/80 transition-colors py-2"
                  onClick={handleMarkAllRead}
                >
                  Mark all as read
                </button>
              )}
              <button
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                onClick={onClose}
                aria-label="Close notifications"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3 3l8 8M11 3l-8 8" />
                </svg>
              </button>
            </div>
          </div>

          {/* Nudge list */}
          <div className="flex-1 overflow-y-auto">
            {nudges.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-muted-foreground">
                <span className="text-2xl mb-2">👍</span>
                <p className="text-sm">You&apos;re all caught up</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {nudges.map(nudge => (
                  <NudgeCard
                    key={nudge.id}
                    nudge={nudge}
                    onDismiss={handleDismiss}
                    onTap={handleTap}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
