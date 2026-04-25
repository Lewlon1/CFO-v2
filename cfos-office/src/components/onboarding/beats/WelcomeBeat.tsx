'use client'

import ReactMarkdown from 'react-markdown'
import {
  buildWelcomeCopy,
  formatMonthsPhrase,
  WELCOME_CHIPS,
} from '@/lib/onboarding/welcome-copy'
import type { ArchetypeData } from '@/lib/onboarding/types'

interface WelcomeBeatProps {
  archetypeData?: ArchetypeData
  monthsOfData: number
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

export function WelcomeBeat({ archetypeData, monthsOfData }: WelcomeBeatProps) {
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
  ].filter((p) => p.trim().length > 0)

  return (
    <div className="px-4 py-2 ml-[40px] animate-[fade-in_0.4s_ease-out] space-y-1 max-w-[min(calc(100%-40px),460px)]">
      <div className="text-sm text-[var(--text-primary)] leading-relaxed font-[var(--font-dm-sans)] prose prose-invert prose-sm max-w-none">
        {paragraphs.map((text, i) => (
          <ReactMarkdown key={i} components={mdComponents}>
            {text}
          </ReactMarkdown>
        ))}
      </div>

      <ul className="pt-3 space-y-1.5 text-sm text-[var(--text-secondary)]">
        {WELCOME_CHIPS.map((chip) => (
          <li key={chip.id} className="flex gap-2 leading-relaxed">
            <span aria-hidden className="text-[var(--text-tertiary)]">·</span>
            <span>{chip.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
