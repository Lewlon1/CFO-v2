import type { Metadata } from 'next'
import { Instrument_Serif, Instrument_Sans } from 'next/font/google'
import { ThemeBoot } from '@/components/landing/ThemeBoot'
import { ThemeToggle } from '@/components/landing/ThemeToggle'
import './v4.css'

const instrumentSerif = Instrument_Serif({
  variable: '--font-instrument-serif',
  weight: '400',
  style: ['normal', 'italic'],
  subsets: ['latin'],
  display: 'swap',
})

const instrumentSans = Instrument_Sans({
  variable: '--font-instrument-sans',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: "More from your money. Less of your time. — The CFO's Office",
  description:
    'A personal CFO that runs the maths, watches your spending, and coaches you toward your goals. Built in Europe. Free to try.',
}

export default function V4Layout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div
      className={`landing-v4 ${instrumentSerif.variable} ${instrumentSans.variable} min-h-dvh`}
      data-theme="dark"
    >
      <ThemeBoot />
      <div className="fixed top-4 right-4 sm:top-6 sm:right-6 z-50">
        <ThemeToggle />
      </div>
      {children}
    </div>
  )
}
