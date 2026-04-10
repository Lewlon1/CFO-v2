'use client'

import { DollarSign, Heart, Scale, Sparkles } from 'lucide-react'
import { useDashboardData } from '@/lib/hooks/useDashboardData'
import { FolderSection } from '@/components/office/FolderSection'
import { CashFlowSection } from '@/components/office/sections/CashFlowSection'
import { ValuesSection } from '@/components/office/sections/ValuesSection'
import { NetWorthSection } from '@/components/office/sections/NetWorthSection'
import { ScenariosSection } from '@/components/office/sections/ScenariosSection'

interface OfficeHomeClientProps {
  provenance?: { source: string | null; uploadDate: string | null }
  gaps: { trait_key: string; trait_value: string }[]
  archetype: { archetype_name: string | null; archetype_subtitle: string | null } | null
  totalAssets: number
  totalLiabilities: number
  hasBalanceSheet: boolean
  nextTrip: { name: string; start_date: string; end_date: string; total_estimated: number | null; currency: string } | null
  currency: string
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
}: OfficeHomeClientProps) {
  const { summary, isLoading } = useDashboardData()

  return (
    <div className="p-4 space-y-3">
      <FolderSection
        icon={<DollarSign size={16} />}
        label="Cash Flow"
        subtitle="Where your money goes"
        fileCount={summary?.transaction_count}
        accentColor="var(--office-green)"
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
        icon={<Heart size={16} />}
        label="Values"
        subtitle="What your spending says about you"
        accentColor="var(--office-cyan)"
        openHref="/office/values"
      >
        <ValuesSection
          summary={summary}
          isLoading={isLoading}
          gaps={gaps}
          archetype={archetype}
        />
      </FolderSection>

      <FolderSection
        icon={<Scale size={16} />}
        label="Net Worth"
        subtitle="The big picture"
        accentColor="var(--office-purple)"
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
        icon={<Sparkles size={16} />}
        label="Scenarios"
        subtitle="What if..."
        accentColor="var(--office-gold)"
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
