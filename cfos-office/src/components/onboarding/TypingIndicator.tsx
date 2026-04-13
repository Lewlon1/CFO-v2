'use client'

import { CFOAvatar } from '@/components/brand/CFOAvatar'

export function TypingIndicator() {
  return (
    <div className="flex items-start gap-3 px-4 py-2">
      <CFOAvatar size={28} />
      <div className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-gold)] animate-[typing-dot_1.4s_ease-in-out_infinite]" />
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-gold)] animate-[typing-dot_1.4s_ease-in-out_0.2s_infinite]" />
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-gold)] animate-[typing-dot_1.4s_ease-in-out_0.4s_infinite]" />
      </div>
    </div>
  )
}
