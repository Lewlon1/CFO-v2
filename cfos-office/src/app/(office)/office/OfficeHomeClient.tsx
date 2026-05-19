'use client'

import { useEffect } from 'react'
import { useDashboardData } from '@/lib/hooks/useDashboardData'
import { FolderSection } from '@/components/office/FolderSection'
import { CashFlowSection } from '@/components/office/sections/CashFlowSection'
import { ValuesSection } from '@/components/office/sections/ValuesSection'
import { NetWorthSection } from '@/components/office/sections/NetWorthSection'
import { GoalsSection } from '@/components/office/sections/GoalsSection'
import { InboxRow } from '@/components/office/InboxRow'
import { useTrackEvent } from '@/lib/events/use-track-event'
import { folderColors } from '@/lib/tokens'
import type { PrimaryGoal } from '@/lib/goals/primary-goal'
import {
  cashFlowSubtitle,
  netWorthSubtitle,
  valuesSubtitle,
} from '@/components/office/folder-subtitles'

interface OfficeHomeClientProps {
  provenance?: { source: string | null; uploadDate: string | null }
  gaps: { trait_key: string; trait_value: string }[]
  archetype: { archetype_name: string | null; archetype_subtitle: string | null } | null
  totalAssets: number
  totalLiabilities: number
  hasBalanceSheet: boolean
  currency: string
  profileCompleteness: number
  primaryGoal: PrimaryGoal | null
  upcomingEventsCount: number
}

export function OfficeHomeClient({
  provenance,
  gaps,
  archetype,
  totalAssets,
  totalLiabilities,
  hasBalanceSheet,
  currency,
  profileCompleteness,
  primaryGoal,
  upcomingEventsCount,
}: OfficeHomeClientProps) {
  const { summary, isLoading } = useDashboardData()
  const trackEvent = useTrackEvent()

  useEffect(() => {
    trackEvent('home_viewed', 'engagement')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const goalsSubtitle = (() => {
    if (!primaryGoal) return 'Not yet set'
    if (!primaryGoal.target_amount || primaryGoal.target_amount <= 0) return primaryGoal.name
    const current = Math.max(0, primaryGoal.current_amount ?? 0)
    const pct = Math.min(100, Math.round((current / primaryGoal.target_amount) * 100))
    return `${primaryGoal.name} · ${pct}%`
  })()

  const cashFlowFallback = `${summary?.month ? new Date(summary.month).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : 'This month'} · ${summary?.transaction_count ?? 0} transactions`
  const cashFlowSub = cashFlowSubtitle(summary, primaryGoal, cashFlowFallback)
  const valuesSub = valuesSubtitle(archetype?.archetype_name ?? null, profileCompleteness, primaryGoal)
  const netWorthSub = netWorthSubtitle(totalAssets, totalLiabilities, primaryGoal)

  return (
    <div className="px-3.5 pt-2 pb-6">
      {/* Inbox row — shows when there are unread nudges */}
      <InboxRow />

      <FolderSection
        icon="◎"
        label="Goals"
        subtitle={goalsSubtitle}
        accentColor={folderColors.goals}
        openHref="/office/goals"
      >
        {/* Experiments slot — wired by v2.6 once claude/experiment-engine-oKzua lands. */}
        <GoalsSection
          goal={primaryGoal}
          currency={currency}
          upcomingEventsCount={upcomingEventsCount}
        />
      </FolderSection>

      <FolderSection
        icon="$"
        label="Cash Flow"
        subtitle={cashFlowSub}
        accentColor={folderColors.cashflow}
        openHref="/office/cash-flow"
      >
        <CashFlowSection
          summary={summary}
          isLoading={isLoading}
          currency={currency}
          provenance={provenance}
        />
      </FolderSection>

      <FolderSection
        icon="◈"
        label="Values & You"
        subtitle={valuesSub}
        accentColor={folderColors.values}
        openHref="/office/values"
      >
        <ValuesSection
          summary={summary}
          isLoading={isLoading}
          gaps={gaps}
          archetype={archetype}
          profileCompleteness={profileCompleteness}
        />
      </FolderSection>

      <FolderSection
        icon="≡"
        label="Net Worth"
        subtitle={netWorthSub}
        accentColor={folderColors.networth}
        openHref="/office/net-worth"
      >
        <NetWorthSection
          totalAssets={totalAssets}
          totalLiabilities={totalLiabilities}
          currency={currency}
          hasData={hasBalanceSheet}
        />
      </FolderSection>
    </div>
  )
}

export default OfficeHomeClient
