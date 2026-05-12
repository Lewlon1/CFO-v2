import { redirect } from 'next/navigation'
import { JetBrains_Mono, DM_Sans, Cormorant_Garamond } from 'next/font/google'
import { createClient } from '@/lib/supabase/server'

// Layout reads per-user profile from Supabase (onboarding state, currency,
// display name) — must re-render on every request, never cache at the route
// level so onboarding-state changes are reflected immediately.
export const dynamic = 'force-dynamic'
import { CFOAvatar } from '@/components/brand/CFOAvatar'
import { ChatProvider } from '@/components/chat/ChatProvider'
import { ChatBar } from '@/components/chat/ChatBar'
import { ChatSheet } from '@/components/chat/ChatSheet'
import { NavigationBar } from '@/components/navigation/NavigationBar'
import { ChatOpenerTrigger } from '@/components/onboarding-v2/chat-opener-trigger'
import { UserAvatarMenu } from '@/components/office/UserAvatarMenu'
import { formatHeaderDate, getGreeting } from '@/lib/utils'

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  display: 'swap',
})

const dmSans = DM_Sans({
  variable: '--font-dm-sans',
  subsets: ['latin'],
  display: 'swap',
})

const cormorantGaramond = Cormorant_Garamond({
  variable: '--font-cormorant',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
})

export default async function OfficeLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const initial = (user.email?.[0] ?? '?').toUpperCase()

  // Fetch user currency + display name for chat context & header
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('primary_currency, display_name, onboarding_completed_at, entry_struggle')
    .eq('id', user.id)
    .single()

  // Any incomplete user without a v2 entry_struggle goes into the v2 flow.
  // Mid-v2 users (entry_struggle set) and completed users fall through.
  if (!profile?.onboarding_completed_at && !profile?.entry_struggle) {
    redirect('/onboarding-v2')
  }

  const currency = profile?.primary_currency ?? 'EUR'
  const displayName = profile?.display_name
    ?? user.user_metadata?.full_name?.split(' ')[0]
    ?? user.email?.split('@')[0]
    ?? null

  return (
    <div
      className={`${jetbrainsMono.variable} ${dmSans.variable} ${cormorantGaramond.variable} h-dvh flex flex-col overflow-hidden bg-office-bg text-office-text font-ui`}
    >
      {/* Header */}
      <header className="flex items-center gap-[11px] px-4 pt-4 pb-1.5 shrink-0 bg-bg-base z-10">
        <CFOAvatar size={48} withOnlineDot />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline" style={{ lineHeight: 1 }}>
            <span className="font-data text-[9px] font-normal tracking-[0.04em] text-[rgba(245,245,240,0.2)] mr-1.5">
              THE
            </span>
            <span
              style={{ fontFamily: 'var(--font-cormorant), serif', fontSize: 18, fontWeight: 600 }}
              className="text-[rgba(245,245,240,0.45)]"
            >
              CFO&apos;s Office
            </span>
          </div>
          <p className="text-[15px] font-bold mt-[3px]">
            {getGreeting()},{' '}
            {displayName && <span className="text-accent-gold">{displayName}</span>}
          </p>
        </div>
        <div className="text-right shrink-0">
          <span className="font-data text-[11px] text-[rgba(245,245,240,0.4)]">
            {formatHeaderDate()}
          </span>
        </div>
        <UserAvatarMenu initial={initial} />
      </header>

      <ChatProvider userCurrency={currency}>
        {/* Persistent chat bar — always visible, between header and nav */}
        <ChatBar />

        {/* Navigation bar (back button on sub-pages) */}
        <NavigationBar />

        {/* Scrollable content */}
        <main className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-[430px] mx-auto w-full">
            {children}
          </div>
        </main>

        {/* Chat sheet overlay */}
        <ChatSheet />

        {/* Reads ?chat=open&conversationId=...[&fto=1] from URL after the
            onboarding-v2 server action redirects here, opens the drawer,
            loads the conversation, and triggers free-text opener if needed. */}
        <ChatOpenerTrigger />
      </ChatProvider>
    </div>
  )
}
