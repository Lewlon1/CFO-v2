'use client'

import ReactMarkdown from 'react-markdown'
import {
  buildWelcomeCopy,
  formatMonthsPhrase,
  WELCOME_CHIPS,
  type WelcomeChip,
} from '@/lib/onboarding/welcome-copy'
import type { ArchetypeData } from '@/lib/onboarding/types'

interface WelcomeBeatProps {
  archetypeData?: ArchetypeData
  monthsOfData: number
  onChipTap: (chip: WelcomeChip) => void
}

const mdComponents = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-3 last:mb-0 text-sm text-[var(--text-primary)] leading-relaxed">
      {children}
    </p>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-[var(--text-primary)]">{children}</strong>
  ),
}

export function WelcomeBeat({ archetypeData, monthsOfData, onChipTap }: WelcomeBeatProps) {
  const copy = buildWelcomeCopy({
    archetypeName: archetypeData?.archetype_name ?? 'new here',
    archetypeSubtitle: archetypeData?.archetype_subtitle ?? 'let\u2019s figure it out together',
    monthsPhrase: formatMonthsPhrase(monthsOfData),
  })

  const paragraphs = [
    copy.opening,
    copy.transition,
    copy.whatItIs,
    copy.shareMore,
    copy.useCases,
    copy.invitation,
  ]

  return (
    <div className="px-4 py-2 ml-[40px] animate-[fade-in_0.4s_ease-out] space-y-1 max-w-[min(calc(100%-40px),460px)]">
      <div className="text-sm text-[var(--text-primary)] leading-relaxed font-[var(--font-dm-sans)] prose prose-invert prose-sm max-w-none">
        {paragraphs.map((text, i) => (
          <ReactMarkdown key={i} components={mdComponents}>
            {text}
          </ReactMarkdown>
        ))}
      </div>

      <div className="flex flex-col gap-2 pt-4">
        {WELCOME_CHIPS.map((chip) => (
          <button
            key={chip.id}
            onClick={() => onChipTap(chip)}
            className={`w-full px-4 py-3 rounded-xl text-sm text-left min-h-[44px]
              transition-all active:scale-[0.98] transform
              ${chip.primary
                ? 'bg-[var(--accent-gold)] text-[#0F0F0D] font-semibold hover:brightness-110'
                : 'border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
              }`}
          >
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  )
}
