'use client';

import { useOnlineStatus } from '@/lib/hooks/useOnlineStatus';

export function OfflineBanner() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="bg-amber-500 text-amber-950 text-center text-sm py-2 px-4 font-medium">
      You&apos;re offline. Some features may not work.
    </div>
  );
}
