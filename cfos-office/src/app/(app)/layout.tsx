import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { LogoutButton } from '@/components/app/logout-button'
import { MobileNav } from '@/components/app/mobile-nav'
import { ProfileCompleteness } from '@/components/app/profile-completeness'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { OfflineBanner } from '@/components/app/OfflineBanner'
import { SessionTracker } from '@/components/analytics/SessionTracker'
import { OnboardingModal } from '@/components/onboarding/OnboardingModal'

const navItems = [
  { href: '/chat', label: 'Chat', icon: '💬' },
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/balance-sheet', label: 'Balance Sheet', icon: '⚖️' },
  { href: '/bills', label: 'Bills', icon: '📋' },
  { href: '/transactions', label: 'Transactions', icon: '↕' },
  { href: '/goals', label: 'Goals', icon: '🎯' },
  { href: '/scenarios', label: 'What if...', icon: '🔮' },
  { href: '/trips', label: 'Trips', icon: '✈️' },
  { href: '/profile', label: 'Profile', icon: '👤' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
]

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  let { data: userProfile } = await supabase
    .from('user_profiles')
    .select('profile_completeness, onboarding_completed_at, onboarding_progress, display_name, primary_currency')
    .eq('id', user.id)
    .single()

  // Belt-and-suspenders: if handle_new_user trigger failed, create profile row
  if (!userProfile) {
    await supabase.from('user_profiles').upsert({ id: user.id }, { onConflict: 'id' })
    userProfile = { profile_completeness: 0, onboarding_completed_at: null, onboarding_progress: null, display_name: null, primary_currency: 'GBP' }
  }

  const profileCompleteness = userProfile?.profile_completeness ?? 0

  const showOnboarding = !userProfile?.onboarding_completed_at

  return (
  <>
    <div className="flex h-dvh overflow-hidden">
      {/* Sidebar — desktop */}
      <aside className="hidden md:flex w-56 flex-col bg-card border-r border-border flex-shrink-0">
        {/* Logo + Notifications */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-sm bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm flex-shrink-0">
              £
            </div>
            <span className="text-sm font-semibold text-foreground leading-tight">
              The CFO&apos;s<br />Office
            </span>
          </div>
          <NotificationBell />
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors group"
            >
              <span className="text-base leading-none">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.href === '/profile' && profileCompleteness < 100 && (
                <span className="text-[10px] tabular-nums text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded">
                  {profileCompleteness}%
                </span>
              )}
            </Link>
          ))}
        </nav>

        {/* Profile completeness nudge */}
        <div className="px-3 pt-2 pb-3 border-t border-border">
          <ProfileCompleteness completeness={profileCompleteness} />
        </div>

        {/* User info + logout */}
        <div className="px-3 py-4 border-t border-border space-y-2">
          <p className="px-3 text-xs text-muted-foreground truncate">{user.email}</p>
          <LogoutButton />
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-card">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-sm bg-primary flex items-center justify-center text-primary-foreground font-bold text-xs">
              £
            </div>
            <span className="text-sm font-semibold text-foreground">The CFO&apos;s Office</span>
          </div>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <MobileNav navItems={navItems} userEmail={user.email ?? ''} profileCompleteness={profileCompleteness} />
          </div>
        </header>

        <OfflineBanner />
        <SessionTracker />
        <main className="flex-1 overflow-auto min-h-0">
          {children}
        </main>
      </div>
    </div>

    {showOnboarding && (
      <OnboardingModal
        initialProgress={userProfile?.onboarding_progress as import('@/lib/onboarding/types').OnboardingState | null}
        userName={userProfile?.display_name ?? undefined}
        currency={userProfile?.primary_currency ?? 'GBP'}
      />
    )}
  </>
  )
}
