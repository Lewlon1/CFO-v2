import type { ReactNode } from 'react'

interface BriefingProps {
  accentColor: string
  children: ReactNode
}

export function Briefing({ accentColor, children }: BriefingProps) {
  return (
    <div
      className="rounded-control mb-4 px-[14px] py-[14px]"
      style={{
        // Phase 3b: frozen white overlay → theme-reactive tint off --text-primary
        // (vellum in dark, ink in light) so the briefing card reads in both themes.
        background: `linear-gradient(180deg, color-mix(in oklab, var(--text-primary) 2.5%, transparent) 0%, color-mix(in oklab, var(--text-primary) 1.5%, transparent) 100%)`,
        border: '0.5px solid var(--border-medium)',
        borderLeft: `2px solid ${accentColor}`,
      }}
    >
      <p
        style={{
          fontFamily: 'var(--font-cormorant), Georgia, serif',
          fontSize: 16,
          lineHeight: 1.45,
          color: 'var(--text-primary)',
        }}
      >
        {children}
      </p>
      <p
        className="mt-2"
        style={{
          fontFamily: 'var(--font-cormorant), Georgia, serif',
          fontStyle: 'italic',
          fontSize: 13,
          color: 'var(--text-secondary)',
        }}
      >
        &mdash; C.
      </p>
    </div>
  )
}

export default Briefing
