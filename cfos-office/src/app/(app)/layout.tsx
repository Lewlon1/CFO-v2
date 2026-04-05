import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { LogoutButton } from '@/components/app/logout-button'
import { MobileNav } from '@/components/app/mobile-nav'

const navItems = [
  { href: '/chat', label: 'Chat', icon: '💬' },
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/bills', label: 'Bills', icon: '📋' },
  { href: '/transactions', label: 'Transactions', icon: '↕' },
  { href: '/scenarios', label: 'What if...', icon: '🔮' },
  { href: '/trips', label: 'Trips', icon: '✈️' },
  { href: '/profile', label: 'Profile', icon: '👤' },
]

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: userProfile } = await supabase
    .from('user_profiles')
    .select('profile_completeness')
    .eq('id', user.id)
    .single()

  const profileCompleteness = userProfile?.profile_completeness ?? 0

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Sidebar — desktop */}
      <aside className="hidden md:flex w-56 flex-col bg-card border-r border-border flex-shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-border">
          <div className="w-7 h-7 rounded-sm bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm flex-shrink-0">
            £
          </div>
          <span className="text-sm font-semibold text-foreground leading-tight">
            The CFO&apos;s<br />Office
          </span>
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
          <MobileNav navItems={navItems} userEmail={user.email ?? ''} />
        </header>

        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
