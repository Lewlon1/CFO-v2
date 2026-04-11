import { redirect } from 'next/navigation'
import { JetBrains_Mono, DM_Sans, Cormorant_Garamond } from 'next/font/google'
import { createClient } from '@/lib/supabase/server'
import { CFOAvatar } from '@/components/brand/CFOAvatar'
import { Breadcrumb } from '@/components/navigation/Breadcrumb'
import { ChatProvider } from '@/components/chat/ChatProvider'
import { ChatBar } from '@/components/chat/ChatBar'
import { ChatSheet } from '@/components/chat/ChatSheet'

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

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export default async function OfficeLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const initial = (user.email?.[0] ?? '?').toUpperCase()

  // Fetch user currency for chat context
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('primary_currency')
    .eq('id', user.id)
    .single()

  const currency = profile?.primary_currency ?? 'EUR'

  return (
    <div
      className={`${jetbrainsMono.variable} ${dmSans.variable} ${cormorantGaramond.variable} h-dvh flex flex-col overflow-hidden bg-office-bg text-office-text font-ui`}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-[18px] pt-[14px] pb-[10px] shrink-0 border-b border-border-medium">
        <div className="flex items-center gap-2.5">
          <CFOAvatar size={30} />
          <div>
            <div className="flex items-baseline" style={{ lineHeight: 1.1 }}>
              <span className="font-data text-[10px] font-normal tracking-[0.04em] text-[rgba(245,245,240,0.35)] mr-1.5">
                THE
              </span>
              <span
                style={{ fontFamily: 'var(--font-cormorant), serif', fontSize: 21, fontWeight: 600, letterSpacing: '-0.02em' }}
                className="text-text-primary"
              >
                CFO&apos;s Office
              </span>
            </div>
            <p className="font-data text-[9px] text-text-muted mt-[3px]">
              {formatDate(new Date())}
            </p>
          </div>
        </div>
        <div className="w-8 h-8 rounded-full bg-accent-gold-bg border border-accent-gold-border flex items-center justify-center text-[11px] font-medium text-accent-gold-soft">
          {initial}
        </div>
      </header>

      {/* Breadcrumb — 36px */}
      <Breadcrumb />

      <ChatProvider userCurrency={currency}>
        {/* Scrollable content */}
        <main className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-[430px] mx-auto w-full">
            {children}
          </div>
        </main>

        {/* Persistent chat bar */}
        <ChatBar />

        {/* Chat sheet overlay */}
        <ChatSheet />
      </ChatProvider>
    </div>
  )
}
