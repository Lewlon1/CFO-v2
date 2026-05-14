import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { JetBrains_Mono, DM_Sans, Cormorant_Garamond } from 'next/font/google'
import { createClient } from '@/lib/supabase/server'
import { recomputeIfStale } from '@/lib/goals/recompute'

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
import { GoalBeatWatcher } from '@/components/onboarding-v2/goal-beat-watcher'
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

  // Fetch user currency + display name for chat context & header.
  // goals_last_synced_at is folded into the same SELECT to avoid a second DB
  // trip — it's read below to decide whether to fire a per-session recompute.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('primary_currency, display_name, onboarding_completed_at, entry_struggle, onboarding_step, goals_last_synced_at')
    .eq('id', user.id)
    .single()

  // Any incomplete user without a v2 entry_struggle goes into the v2 flow.
  // Mid-v2 users (entry_struggle set) and completed users fall through.
  if (!profile?.onboarding_completed_at && !profile?.entry_struggle) {
    redirect('/onboarding-v2')
  }

  // If the user is mid-Marcus-journey (post-goal-beat), bounce them back to
  // the appropriate onboarding-v2 step. Without this, a Marcus user could
  // navigate manually to /office and skip the value-map / upload / archetype.
  const onboardingStep = (profile?.onboarding_step as string | null) ?? null
  const isMarcus = profile?.entry_struggle === 'dont_know'
  const MID_MARCUS_STEPS = new Set(['goal_set', 'goal_skipped', 'value_map_started', 'value_map_done', 'upload_done', 'archetype_shown'])
  if (isMarcus && !profile?.onboarding_completed_at && onboardingStep && MID_MARCUS_STEPS.has(onboardingStep)) {
    if (onboardingStep === 'goal_set' || onboardingStep === 'goal_skipped' || onboardingStep === 'value_map_started') {
      redirect('/onboarding-v2/value-map')
    }
    if (onboardingStep === 'value_map_done') redirect('/onboarding-v2/upload')
    if (onboardingStep === 'upload_done' || onboardingStep === 'archetype_shown') redirect('/onboarding-v2/archetype')
  }

  // If the user is mid-goal-beat, look up their active goal-chat conversation
  // so the GoalBeatWatcher can open it in the chat sheet.
  let goalChatConversationId: string | null = null
  if (onboardingStep === 'goal_chat_started') {
    const { data: goalConv } = await supabase
      .from('conversations')
      .select('id')
      .eq('user_id', user.id)
      .eq('type', 'onboarding_goal_chat')
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    goalChatConversationId = goalConv?.id ?? null
  }

  const currency = profile?.primary_currency ?? 'EUR'
  const displayName = profile?.display_name
    ?? user.user_metadata?.full_name?.split(' ')[0]
    ?? user.email?.split('@')[0]
    ?? null

  // Once-per-session goal recompute. Runs fire-and-forget after the response
  // is sent so it never blocks render. 30-minute TTL gate (in recomputeIfStale)
  // is well within the "up to one session's staleness is acceptable"
  // tolerance. Errors are logged but invisible to the user — they see
  // last-known numbers if a recompute fails.
  const userId = user.id
  const lastSyncedIso = profile?.goals_last_synced_at ?? null
  after(async () => {
    try {
      const recomputeClient = await createClient()
      await recomputeIfStale(recomputeClient, userId, lastSyncedIso)
    } catch (err) {
      console.error('[goals-recompute] failed:', err)
    }
  })

  return (
    <div
      className={`${jetbrainsMono.variable} ${dmSans.variable} ${cormorantGaramond.variable} h-dvh flex flex-col overflow-hidden bg-office-bg text-office-text font-ui`}
    >
      {/* Header */}
      <header className="flex items-center gap-[11px] px-4 pt-4 pb-1.5 shrink-0 bg-bg-base z-10">
        <CFOAvatar size={48} withOnlineDot />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline" style={{ lineHeight: 1 }}>
            <span className="font-data text-[9px] font-normal tracking-[0.04em] text-text-muted mr-1.5">
              THE
            </span>
            <span
              style={{ fontFamily: 'var(--font-cormorant), serif', fontSize: 18, fontWeight: 600 }}
              className="text-text-secondary"
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
          <span className="font-data text-[11px] text-text-tertiary">
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

        {/* Activates only when onboarding_step='goal_chat_started'. Opens the
            goal-chat conversation in the sheet, polls /api/goals/active-count
            for create_goal completion, advances the step + routes onward.
            Renders a skip control after 90s for dont_know users. */}
        <GoalBeatWatcher
          onboardingStep={onboardingStep}
          entryStruggle={profile?.entry_struggle ?? null}
          goalChatConversationId={goalChatConversationId}
        />
      </ChatProvider>
    </div>
  )
}
