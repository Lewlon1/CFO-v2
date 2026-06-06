import type { ReactNode } from 'react'
import { JetBrains_Mono, DM_Sans, Cormorant_Garamond } from 'next/font/google'

// Mirrors the office layout's font setup (src/app/(office)/layout.tsx) so the
// full-page onboarding routes (value-map / first-read / archetype) render in the
// office type system — DM Sans body, JetBrains data, Cormorant headings — instead
// of falling back to the root layout's Instrument/Geist. `font-ui` activates the
// office heading override (.font-ui :is(h1,h2,h3) → Cormorant) in globals.css.
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

export default function OnboardingV2Layout({ children }: { children: ReactNode }) {
  return (
    <div className={`${jetbrainsMono.variable} ${dmSans.variable} ${cormorantGaramond.variable} font-ui`}>
      {children}
    </div>
  )
}
