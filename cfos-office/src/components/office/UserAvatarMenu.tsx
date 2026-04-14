'use client'

import Link from 'next/link'

interface UserAvatarMenuProps {
  initial: string
}

export function UserAvatarMenu({ initial }: UserAvatarMenuProps) {
  return (
    <Link
      href="/office/settings"
      aria-label="Settings"
      className="w-8 h-8 rounded-full bg-accent-gold-bg border border-accent-gold-border flex items-center justify-center text-[12px] font-bold text-accent-gold shrink-0"
    >
      {initial}
    </Link>
  )
}

export default UserAvatarMenu
