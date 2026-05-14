import type { Metadata } from 'next'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import './v4.css'

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
    <div className="landing-v4 min-h-dvh">
      <div className="fixed top-4 right-4 sm:top-6 sm:right-6 z-50">
        <ThemeToggle className="v4-toggle" />
      </div>
      {children}
    </div>
  )
}
