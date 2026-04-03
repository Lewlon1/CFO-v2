'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface MobileNavProps {
  navItems: { href: string; label: string; icon: string }[]
  userEmail: string
}

export function MobileNav({ navItems, userEmail }: MobileNavProps) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="p-3 -mr-1 text-muted-foreground hover:text-foreground"
        aria-label="Toggle menu"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {open ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {open && (
        <div className="absolute top-14 left-0 right-0 z-50 bg-card border-b border-border py-2 px-3 space-y-0.5">
          {navItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent min-h-[44px]"
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          ))}
          <div className="pt-2 border-t border-border mt-2">
            <p className="px-3 text-xs text-muted-foreground mb-1 truncate">{userEmail}</p>
            <button
              onClick={handleLogout}
              className="w-full px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent text-left"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </>
  )
}
