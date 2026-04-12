'use client'

import { useEffect } from 'react'
import { useDashboardData } from '@/lib/hooks/useDashboardData'
import { FolderSection } from '@/components/office/FolderSection'
import { CashFlowSection } from '@/components/office/sections/CashFlowSection'
import { ValuesSection } from '@/components/office/sections/ValuesSection'
import { NetWorthSection } from '@/components/office/sections/NetWorthSection'
import { ScenariosSection } from '@/components/office/sections/ScenariosSection'
import { InboxRow } from '@/components/office/InboxRow'
import { useTrackEvent } from '@/lib/events/use-track-event'

interface OfficeHomeClientProps {
  provenance?: { source: string | null; uploadDate: string | null }
  gaps: { trait_key: string; trait_value: string }[]
  archetype: { archetype_name: string | null; archetype_subtitle: string | null } | null
  totalAssets: number
  totalLiabilities: number
  hasBalanceSheet: boolean
  nextTrip: { name: string; start_date: string; end_date: string; total_estimated: number | null; currency: string } | null
  currency: string
  profileCompleteness: number
}

export function OfficeHomeClient({
  provenance,
  gaps,
  archetype,
  totalAssets,
  totalLiabilities,
  hasBalanceSheet,
  nextTrip,
  currency,
  profileCompleteness,
}: OfficeHomeClientProps) {
  const { summary, isLoading } = useDashboardData()
  const trackEvent = useTrackEvent()

  useEffect(() => {
    trackEvent('home_viewed', 'engagement')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="px-3.5 pt-2 pb-6">
      {/* Inbox row — shows when there are unread nudges */}
      <InboxRow />

      <FolderSection
        icon="$"
        label="Cash Flow"
        subtitle={`${summary?.month ? new Date(summary.month).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : 'This month'} · ${summary?.transaction_count ?? 0} transactions`}
        accentColor="#22C55E"
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
        subtitle={`${archetype?.archetype_name ?? 'Not yet profiled'} · ${Math.round(profileCompleteness)}% profiled`}
        accentColor="#E8A84C"
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
        subtitle="The big picture"
        accentColor="#06B6D4"
        openHref="/office/net-worth"
      >
        <NetWorthSection
          totalAssets={totalAssets}
          totalLiabilities={totalLiabilities}
          currency={currency}
          hasData={hasBalanceSheet}
        />
      </FolderSection>

      <FolderSection
        icon="⊕"
        label="Scenario Planning"
        subtitle="What if..."
        accentColor="#F43F5E"
        openHref="/office/scenarios"
      >
        <ScenariosSection
          nextTrip={nextTrip}
          currency={currency}
        />
      </FolderSection>
    </div>
  )
}

export default OfficeHomeClient
