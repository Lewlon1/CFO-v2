import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { JetBrains_Mono, DM_Sans, Cormorant_Garamond } from 'next/font/google'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { recomputeIfStale } from '@/lib/goals/recompute'
import { isInSheetBeatStep, isEstimateBeatStep, estimateStepIndex } from '@/lib/onboarding-v2/in-sheet-steps'
import { resolveEstimateResume } from '@/lib/onboarding-v2/estimate-resume'
import { knowsYou } from '@/lib/onboarding-v2/knows-you'
import { struggleToFamily, type DoorFamily } from '@/lib/onboarding-v2/door/door-config'
import type { CompositeCountry } from '@/lib/onboarding-v2/composite/composite-config'
import type { EstimateOnboardingContext } from '@/lib/onboarding-v2/estimate-context'
import { resolveUserCurrency } from '@/lib/analytics/resolve-user-currency'
import type { OnboardingGoalSummary } from '@/lib/onboarding-v2/types'

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
    .select('primary_currency, display_name, onboarding_completed_at, entry_struggle, onboarding_step, goals_last_synced_at, door_family, door_reflection, composite_relate, composite_repick_family, age_range, country, net_monthly_income')
    .eq('id', user.id)
    .single()

  const onboardingStep = (profile?.onboarding_step as string | null) ?? null
  const completed = !!profile?.onboarding_completed_at

  // Genuine legacy value-map mid-flow states bounce back to their onboarding-v2
  // page (these are reached only by the old Marcus flow / the opt-in Value Map,
  // never by a new estimates-first user). Session 32 (B) routes preserved.
  const LEGACY_VM_REDIRECTS: Record<string, string> = {
    value_map_started: '/onboarding-v2/value-map',
    value_map_done: '/onboarding-v2/upload',
    upload_done: '/onboarding-v2/first-read',
    archetype_shown: '/onboarding-v2/archetype',
    first_read_shown: '/onboarding-v2/first-read',
  }
  if (!completed && onboardingStep && LEGACY_VM_REDIRECTS[onboardingStep]) {
    redirect(LEGACY_VM_REDIRECTS[onboardingStep])
  }

  // Steps kept on the legacy value-first in-sheet host (users with transactions
  // mid-pipeline) and the OB-3 statement-check host — NOT the estimate flow.
  const LEGACY_HOST_STEPS = new Set([
    'upload_processing',
    'details_pending',
    'details_confirmed',
    'check_upload_pending',
    'check_processing',
    'check_confirm_pending',
    'check_confirm_done',
  ])

  // Estimates-first onboarding (OB-2): brand-new users and every legacy
  // pre-estimate stamp run the estimate beats in-sheet. Excluded: completed
  // users, the legacy value-first / check host steps, and the legacy value-map
  // states (redirected above).
  const needsEstimateOnboarding =
    !completed &&
    !LEGACY_HOST_STEPS.has(onboardingStep ?? '') &&
    !(onboardingStep != null && onboardingStep in LEGACY_VM_REDIRECTS)

  // Legacy goal-beat (goal_chat_*) is superseded by the estimate flow. It and
  // the legacy in-sheet host only fire for non-estimate users now.
  const goalBeatActive =
    !needsEstimateOnboarding &&
    (onboardingStep === 'goal_chat_started' || onboardingStep === 'goal_chat_tentative')
  const onboardingBeatActive =
    !needsEstimateOnboarding && isInSheetBeatStep(onboardingStep)

  // If the user is mid-goal-beat (either the primary state or the tentative
  // state the chat stall handler moves users into), look up their active
  // goal-chat conversation so the GoalBeatWatcher can open it in the chat
  // sheet.
  let goalChatConversationId: string | null = null
  if (goalBeatActive) {
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

  // Active goal for the upload-beat bridge (so the CFO can acknowledge it by
  // name before asking for statements). Only queried at the upload entry steps.
  let onboardingGoal: OnboardingGoalSummary | null = null
  if (!needsEstimateOnboarding && (onboardingStep === 'upload_pending' || onboardingStep === 'essentials_done')) {
    const { data: activeGoal } = await supabase
      .from('goals')
      .select('name, target_amount, currency')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (activeGoal?.name) {
      onboardingGoal = {
        name: activeGoal.name,
        targetAmount: activeGoal.target_amount ?? null,
        currency: activeGoal.currency ?? currency,
      }
    }
  }

  // Estimates-first onboarding (OB-2): resolve the effective beat and assemble
  // the data bundle the beats + knows-you meter render from. The effective step
  // is the stamped estimate step if there is one, else the data-driven resume
  // point (which also forward-maps legacy pre-estimate stamps and brand-new
  // users onto the door beat).
  let estimateOnboarding: EstimateOnboardingContext | null = null
  let estimateStep: string | null = null
  if (needsEstimateOnboarding) {
    const [{ data: estimates }, { data: activeGoal }] = await Promise.all([
      supabase
        .from('onboarding_estimates')
        .select(
          'housing_band, subs_band, bills_band, food_out_band, save_reach_band, income_monthly, top_value, verdicts, currency',
        )
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase
        .from('goals')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle(),
    ])

    const country: CompositeCountry = profile?.country === 'ES' ? 'ES' : 'GB'
    const ageRange = (profile?.age_range as string | null) ?? null
    const incomeMonthly =
      (estimates?.income_monthly as number | null) ??
      (profile?.net_monthly_income as number | null) ??
      null
    const bands = {
      housing: (estimates?.housing_band as string | null) ?? null,
      subs: (estimates?.subs_band as string | null) ?? null,
      bills: (estimates?.bills_band as string | null) ?? null,
      foodOut: (estimates?.food_out_band as string | null) ?? null,
      saveReach: (estimates?.save_reach_band as string | null) ?? null,
    }
    const sketchBandsCount = Object.values(bands).filter(Boolean).length
    const verdictsCount = Object.keys(
      (estimates?.verdicts as Record<string, unknown> | null) ?? {},
    ).length
    const topValue = (estimates?.top_value as string | null) ?? null
    const hasGoal = !!activeGoal

    // Route to the EARLIER of the stamped estimate step and the data-resolved
    // step. When the stamp has run ahead of the persisted data (e.g. a sketch
    // band failed to save but the step reached read_pending), resolve wins and
    // the user is sent back to the missing beat rather than looping a 500.
    // When the stamp is behind (an action persisted data but the user hasn't
    // tapped through an intermediate screen yet), the stamp wins — preserving
    // the door-reflection and income-pace beats.
    const resolved = resolveEstimateResume({
      doorFamily: (profile?.door_family as string | null) ?? null,
      entryStruggle: profile?.entry_struggle ?? null,
      ageRange,
      country,
      compositeRelate: (profile?.composite_relate as string | null) ?? null,
      hasGoal,
      incomeMonthly,
      sketchBandsCount,
      topValue,
      verdictsCount,
    })
    const stampedIdx = estimateStepIndex(onboardingStep)
    const resolvedIdx = estimateStepIndex(resolved)
    estimateStep =
      stampedIdx >= 0 && stampedIdx < resolvedIdx ? (onboardingStep as string) : resolved

    const knows = knowsYou({
      hasName: !!profile?.display_name,
      hasDoor:
        profile?.door_family != null ||
        struggleToFamily(profile?.entry_struggle ?? null) != null,
      hasContext: ageRange != null,
      hasCompositeRelate: profile?.composite_relate != null,
      hasGoal,
      hasIncome: incomeMonthly != null,
      sketchBandsCount,
      hasTopValue: topValue != null,
      verdictsCount,
      statementChecked: false,
      valueMapDone: false,
    })

    // Effective family for the persona/goal beats: a composite re-pick wins,
    // then the door family, then the legacy struggle reverse-map.
    const effectiveFamily: DoorFamily | null =
      (profile?.composite_repick_family as DoorFamily | null) ??
      (profile?.door_family as DoorFamily | null) ??
      struggleToFamily(profile?.entry_struggle ?? null)

    estimateOnboarding = {
      knowsYou: knows,
      displayName: profile?.display_name ?? null,
      doorFamily: effectiveFamily,
      doorReflection: (profile?.door_reflection as string | null) ?? null,
      country,
      currency: resolveUserCurrency(
        country,
        (estimates?.currency as string | null) ?? profile?.primary_currency ?? null,
        [],
      ),
      bands,
      income: incomeMonthly,
    }
  }

  // The step the client beats dispatch on: the resolved estimate beat when in
  // the estimate flow, otherwise the raw stamped step.
  const providedStep = needsEstimateOnboarding ? estimateStep : onboardingStep

  // Once-per-session goal recompute. Runs fire-and-forget after the response
  // is sent so it never blocks render. 30-minute TTL gate (in recomputeIfStale)
  // is well within the "up to one session's staleness is acceptable"
  // tolerance. Errors are logged but invisible to the user — they see
  // last-known numbers if a recompute fails.
  const userId = user.id
  const lastSyncedIso = profile?.goals_last_synced_at ?? null
  after(async () => {
    try {
      // Use a cookie-free service client: `cookies()` (which createClient calls)
      // is not allowed inside `after()`. The recompute is scoped by userId, so
      // RLS via the request client isn't needed — same pattern as the chat /
      // review `after()` blocks.
      const recomputeClient = createServiceClient()
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

      <ChatProvider
        userCurrency={currency}
        initialSheetOpen={goalBeatActive || onboardingBeatActive || needsEstimateOnboarding}
        onboardingStep={providedStep}
        onboardingGoal={onboardingGoal}
        estimateOnboarding={estimateOnboarding}
      >
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

        {/* Activates when onboarding_step is 'goal_chat_started' or
            'goal_chat_tentative'. Opens the goal-chat conversation in the
            sheet, polls /api/onboarding/essentials-status until income+rent
            both land, advances the step → 'essentials_done' + routes to
            /onboarding-v2/upload. Renders a skip control after 90s for
            dont_know users (legacy → /onboarding-v2/value-map). */}
        <GoalBeatWatcher
          onboardingStep={providedStep}
          entryStruggle={profile?.entry_struggle ?? null}
          goalChatConversationId={goalChatConversationId}
        />
      </ChatProvider>
    </div>
  )
}
