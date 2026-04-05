'use client';

import { useState, useCallback } from 'react';
import useSWR from 'swr';
import { NotificationPanel } from './NotificationPanel';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);

  const { data, mutate } = useSWR<{ count: number }>('/api/nudges/count', fetcher, {
    refreshInterval: 60_000,
  });

  const count = data?.count ?? 0;

  const handleCountChange = useCallback(() => {
    mutate();
  }, [mutate]);

  return (
    <div className="relative">
      <button
        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors relative"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={`Notifications${count > 0 ? ` (${count} unread)` : ''}`}
      >
        {/* Bell SVG */}
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>

        {/* Badge */}
        {count > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[16px] h-[16px] flex items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white px-1">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {isOpen && (
        <NotificationPanel
          onClose={() => setIsOpen(false)}
          onCountChange={handleCountChange}
        />
      )}
    </div>
  );
}
