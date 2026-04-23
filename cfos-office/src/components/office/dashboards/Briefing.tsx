import type { ReactNode } from 'react'

interface BriefingProps {
  accentColor: string
  children: ReactNode
}

export function Briefing({ accentColor, children }: BriefingProps) {
  return (
    <div
      className="rounded-[10px] mb-4 px-[14px] py-[14px]"
      style={{
        background: `linear-gradient(180deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0.015) 100%)`,
        border: '0.5px solid rgba(255,255,255,0.05)',
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
