'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function SignOutButton() {
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="rounded-[10px] border border-[rgba(255,255,255,0.04)] bg-bg-deep p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold text-text-primary">Sign out</p>
          <p className="text-[11px] text-text-secondary mt-0.5">Sign out of your account on this device</p>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="shrink-0 rounded-lg border border-[rgba(255,255,255,0.08)] px-3 py-1.5 text-[12px] font-semibold text-text-primary hover:bg-[rgba(255,255,255,0.04)] transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
