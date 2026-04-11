import { redirect } from 'next/navigation'
import { JetBrains_Mono, DM_Sans } from 'next/font/google'
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

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
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
      className={`${jetbrainsMono.variable} ${dmSans.variable} h-dvh flex flex-col overflow-hidden bg-office-bg text-office-text font-ui`}
    >
      {/* Header — 56px */}
      <header className="flex items-center justify-between px-4 h-14 shrink-0 border-b border-office-border">
        <div className="flex items-center gap-2.5">
          <CFOAvatar size={30} />
          <span className="text-lg font-medium text-office-text">
            The CFO&apos;s Office
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-data text-xs text-office-text-secondary hidden sm:block">
            {formatDate(new Date())}
          </span>
          <div className="w-7 h-7 rounded-full bg-office-bg-tertiary border border-office-border flex items-center justify-center text-xs font-medium text-office-text-secondary">
            {initial}
          </div>
        </div>
      </header>

      {/* Breadcrumb — 36px */}
      <Breadcrumb />

      <ChatProvider userCurrency={currency}>
        {/* Scrollable content */}
        <main className="flex-1 min-h-0 overflow-y-auto">
          {children}
        </main>

        {/* Persistent chat bar */}
        <ChatBar />

        {/* Chat sheet overlay */}
        <ChatSheet />
      </ChatProvider>
    </div>
  )
}
