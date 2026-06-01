'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/button'

export function SignOutButton() {
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <section className="space-y-3">
      <h2 className="text-h3 text-text-primary">Account</h2>
      <Card variant="elevated" className="p-4 space-y-3">
        <p className="text-body text-text-secondary">
          Sign out of your account on this device.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSignOut}
          className="min-h-[44px]"
        >
          Sign out
        </Button>
      </Card>
    </section>
  )
}
